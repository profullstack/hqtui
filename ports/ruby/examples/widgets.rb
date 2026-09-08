#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Every widget the Ruby binding reaches, one method each.
#
# `ruby examples/widgets.rb` renders all of them headlessly and prints the
# result, so this file is a program rather than a snippet dump. The
# `@widget` / `@end` markers are what hqtui.com/widgets slices to show the code
# for one widget, which is why a snippet on the site is always a region of
# something that runs.
#
# Ruby, PHP and Perl all describe a scene as data and hand it to the same
# native core, so they reach the eight widgets that core draws rather than the
# twenty-eight the native ports do. The list is honest about that.
#
# Needs the shared library: build ports/cpp with -DHQTUI_BUILD_BINDINGS=ON, or
# set HQTUI_NATIVE_LIB to one you already built.

require_relative '../lib/hqtui'

CPU_HISTORY = [12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41].freeze

# @widget text
def text(ui)
  # align is 0 left, 1 center, 2 right.
  ui.text('Plain text. It fills the width it is given.')
  ui.text('Centered.', align: 1)
  ui.text('Right aligned.', align: 2)
end
# @end

# @widget divider
def divider(ui)
  ui.text('Above the line')
  ui.divider
  ui.text('Below it')
  ui.divider('status')
  ui.text('A labelled divider titles a section without spending a panel on it')
end
# @end

# @widget keyValues
def key_values(ui)
  # The backbone of every "System" panel: labels left, values right.
  ui.keys([
            ['Host', 'web-01.iad'],
            ['Uptime', '18d 04:12'],
            ['Load', '0.42  0.51  0.60'],
            ['Established', '1,284']
          ])
end
# @end

# @widget table
def table(ui)
  ui.table(
    %w[Name Size Type Modified],
    [
      ['src', '4.2 KB', 'dir', '2m ago'],
      ['test', '1.1 KB', 'dir', '5m ago'],
      ['package.json', '1.2 KB', 'file', '10m ago'],
      ['README.md', '3.4 KB', 'file', '1h ago']
    ],
    selected: 1
  )
end
# @end

# @widget log
def log(ui)
  ui.log([
           { time: '12:45:02', level: 'INFO', message: 'listening on :8080' },
           { time: '12:45:09', level: 'WARN', message: 'slow query 412ms', meta: 'table=users' },
           { time: '12:45:11', level: 'ERROR', message: 'upstream timeout' },
           { time: '12:45:14', level: 'INFO', message: 'retry succeeded' }
         ])
end
# @end

# @widget meter
def meter(ui)
  ui.meter(0.62, label: 'CPU')
  ui.meter(0.31, label: 'MEM')
  ui.meter(0.87, label: 'SWP')
end
# @end

# @widget graph
def graph(ui)
  # Braille line chart, filled under the curve.
  ui.graph(CPU_HISTORY, min: 0, max: 100)
end
# @end

# @widget gauge
def gauge(ui)
  # A semicircular dial. Wants at least nine columns by five rows.
  ui.gauge(0.62, label: '62%')
end
# @end

# @widget badge
def badge(ui)
  ui.badge('active')
end
# @end

# @widget progress
def progress(ui)
  ui.progress(37, max: 120, label: 'Indexing', count: true)
  ui.progress(0.82, label: 'Upload')
end
# @end

# @widget sparkline
def sparkline(ui)
  ui.sparkline(CPU_HISTORY, label: 'CPU ', text: '44%')
end
# @end

# @widget heatBar
def heat_bar(ui)
  ui.heatbar(0.28)
  ui.heatbar(0.64)
  ui.heatbar(0.91)
end
# @end

# @widget histogram
def histogram(ui)
  # Block columns. Cheaper than Braille and easier to read when short.
  ui.columns(CPU_HISTORY)
end
# @end

# @widget donut
def donut(ui)
  ui.donut([{ value: 4.65, label: 'Used' }, { value: 10.96, label: 'Free' }])
end
# @end

# @widget list
def list(ui)
  ui.list(['apps/demo', 'packages/hqtui', 'apps/web', 'docs'], selected: 0, bullet: '▸')
end
# @end

# @widget tree
def tree(ui)
  ui.tree([{ label: 'systemd', children: [{ label: 'bash' }, { label: 'postgres' }] }], selected: 1)
end
# @end

# @widget button
def button(ui)
  # variant: 0 primary, 1 success, 2 warning, 3 danger, 4 ghost.
  ui.button('Primary')
end
# @end

# @widget checkbox
def checkbox(ui)
  ui.checkbox('Toggle', checked: true, variant: 1)
  ui.checkbox('Checkbox', checked: false)
end
# @end

# @widget select
def select(ui)
  ui.select('Dracula', open: true, options: %w[Dark Dracula Nord], selected: 1)
end
# @end

# @widget textInput
def text_input(ui)
  ui.input('postgres', label: 'Search')
end
# @end

# @widget tabs
def tabs(ui)
  ui.tabs(['1 dashboard', '2 traffic', '3 sessions'], active: 1)
end
# @end

# @widget statusBar
def status_bar(ui)
  ui.statusbar([{ key: 'F1', label: 'Help' }, { key: 'q', label: 'Quit' }],
               right: [{ label: '0.41ms' }])
end
# @end

EXAMPLES = {
  'text' => method(:text),
  'divider' => method(:divider),
  'keyValues' => method(:key_values),
  'table' => method(:table),
  'log' => method(:log),
  'meter' => method(:meter),
  'graph' => method(:graph),
  'gauge' => method(:gauge),
  'badge' => method(:badge),
  'progress' => method(:progress),
  'sparkline' => method(:sparkline),
  'heatBar' => method(:heat_bar),
  'histogram' => method(:histogram),
  'donut' => method(:donut),
  'list' => method(:list),
  'tree' => method(:tree),
  'button' => method(:button),
  'checkbox' => method(:checkbox),
  'select' => method(:select),
  'textInput' => method(:text_input),
  'tabs' => method(:tabs),
  'statusBar' => method(:status_bar)
}.freeze

# Renders each widget on its own small screen and prints the lot.
blank = 0
EXAMPLES.each do |name, draw|
  ui = Hqtui::UI.new('col')
  draw.call(ui)
  scene = Hqtui::Scene.new(width: 62, height: 12, theme: 'dark')
  begin
    rendered = scene.set(ui).render('text')
  ensure
    scene.close
  end
  if rendered.strip.empty?
    warn "FAIL #{name}: rendered an empty screen"
    blank += 1
    next
  end
  puts "--- #{name}\n#{rendered.rstrip}"
end

warn "#{EXAMPLES.size - blank}/#{EXAMPLES.size} widget examples rendered"
exit(blank.zero? ? 0 : 1)
