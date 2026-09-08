# frozen_string_literal: true
require 'json'
require 'fiddle/import'

module Hqtui
  VERSION = '0.2.0'
  class Error < StandardError; end
  def self.native
    @native ||= Module.new do
      extend Fiddle::Importer
      path = ENV['HQTUI_NATIVE_LIB'] || File.expand_path('../../cpp/build-bindings/libhqtui_bindings.' + (RUBY_PLATFORM.include?('darwin') ? 'dylib' : 'so'), __dir__)
      raise Error, 'Native library missing. Build ports/cpp with -DHQTUI_BUILD_BINDINGS=ON or set HQTUI_NATIVE_LIB.' unless File.file?(path)
      dlload path
      extern 'int hqb_abi_version()'
      extern 'const char* hqb_error()'
      extern 'void* hqb_create(int, int, const char*)'
      extern 'void hqb_destroy(void*)'
      extern 'int hqb_set(void*, const char*, size_t)'
      extern 'int hqb_resize(void*, int, int)'
      extern 'int hqb_collapse(void*, int)'
      extern 'const char* hqb_render(void*, const char*)'
      extern 'const char* hqb_demo_frame(void*, const char*, const char*)'
      extern 'int hqb_open(void*)'
      extern 'int hqb_present(void*)'
      extern 'const char* hqb_poll(void*, int)'
      extern 'int hqb_interrupted()'
      extern 'void hqb_close(void*)'
      extern 'int hqb_demo(const char*, size_t)'
      raise Error, 'Unsupported native ABI' unless hqb_abi_version == 1
    end
  end
  def self.check(value)
    raise Error, native.hqb_error.to_s if value == 0 || value.nil? || (value.respond_to?(:null?) && value.null?)
    value
  end
  def self.demo(arguments = ARGV)
    encoded = JSON.generate(arguments)
    status = native.hqb_demo(encoded, encoded.bytesize)
    raise Error, native.hqb_error.to_s if status < 0
    status
  end
  class UI
    def initialize(type = 'col', **options)
      @node = { type: type, **options, children: [] }
    end
    def to_h = @node
    def add(type, **options)
      @node[:children] << { type: type, **options }; self
    end
    def group(type, **options)
      child = UI.new(type, **options)
      yield child if block_given?
      @node[:children] << child.to_h; self
    end
    def row(**options, &block) = group('row', **options, &block)
    def col(**options, &block) = group('col', **options, &block)
    def panel(title, **options, &block) = group('panel', title: title, **options, &block)
    def text(text, **options) = add('text', text: text, **options)
    def meter(value, **options) = add('meter', value: value, **options)
    def graph(values, **options) = add('graph', values: values, **options)
    def gauge(value, **options) = add('gauge', value: value, **options)
    def table(columns, rows, **options) = add('table', columns: columns, rows: rows, **options)
    def keys(rows, **options) = add('keys', rows: rows, **options)
    def log(entries, **options) = add('log', entries: entries, **options)
    def spacer(**options) = add('spacer', **options)
    def divider(text = '') = add('divider', text: text)
    def badge(text, **options) = add('badge', text: text, **options)
    def progress(value, **options) = add('progress', value: value, **options)
    def sparkline(values, **options) = add('sparkline', values: values, **options)
    def heatbar(value, **options) = add('heatbar', value: value, **options)
    def columns(values, **options) = add('columns', values: values, **options)
    def donut(segments, **options) = add('donut', segments: segments, **options)
    def list(items, **options) = add('list', items: items, **options)
    def scrollbar(total, **options) = add('scrollbar', total: total, **options)
    def chart(series, **options) = add('chart', series: series, **options)
    def calendar(year, month, **options) = add('calendar', year: year, month: month, **options)
    def tree(nodes, **options) = add('tree', nodes: nodes, **options)
    def button(label, **options) = add('button', label: label, **options)
    def checkbox(label, **options) = add('checkbox', label: label, **options)
    def select(value, **options) = add('select', value: value, **options)
    def input(value, **options) = add('input', value: value, **options)
    def tabs(tabs, **options) = add('tabs', tabs: tabs, **options)
    def statusbar(items, **options) = add('statusbar', items: items, **options)
    def label(text, **options) = add('label', text: text, **options)
    def heading(text, **options) = add('heading', text: text, **options)
    def meters(items, **options) = add('meters', items: items, **options)
    # Overlays take the whole screen, so they carry no size and are drawn last.
    def modal(**options) = add('modal', **options)
    def command_palette(**options) = add('commandpalette', **options)
    def tooltip(text, x:, y:, **options) = add('tooltip', text: text, x: x, y: y, **options)
  end
  class Scene
    def self.finalizer(native, pointer) = proc { native.hqb_destroy(pointer) }
    def initialize(width: 80, height: 24, theme: 'dark')
      @native = Hqtui.native
      @handle = Hqtui.check(@native.hqb_create(width, height, theme))
      ObjectSpace.define_finalizer(self, self.class.finalizer(@native, @handle))
    end
    def initialize_copy(*) = raise(Error, 'Scenes cannot be copied')
    def handle
      raise Error, 'Scene is closed' unless @handle
      @handle
    end
    def set(ui)
      encoded = JSON.generate(ui.respond_to?(:to_h) ? ui.to_h : ui)
      Hqtui.check(@native.hqb_set(handle, encoded, encoded.bytesize)); self
    end
    # Merge the borders of adjacent panels into shared lines.
    def collapse(enabled = true)
      Hqtui.check(@native.hqb_collapse(handle, enabled ? 1 : 0)); self
    end

    def resize(width, height)
      Hqtui.check(@native.hqb_resize(handle, width, height)); self
    end
    def render(format = 'text') = Hqtui.check(@native.hqb_render(handle, format)).to_s.force_encoding(Encoding::UTF_8)
    def demo_frame(screen, format = 'text') = Hqtui.check(@native.hqb_demo_frame(handle, screen, format)).to_s.force_encoding(Encoding::UTF_8)
    def present = Hqtui.check(@native.hqb_present(handle))
    def poll(timeout_ms = 33) = Hqtui.check(@native.hqb_poll(handle, timeout_ms)).to_s
    def interrupted? = @native.hqb_interrupted != 0
    def with_terminal
      Hqtui.check(@native.hqb_open(handle))
      begin
        yield self
      ensure
        @native.hqb_close(handle) if @handle
      end
    end
    def close
      return unless @handle
      ObjectSpace.undefine_finalizer(self)
      @native.hqb_destroy(@handle); @handle = nil
    end
  end
end
