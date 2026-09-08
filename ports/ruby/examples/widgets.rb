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
# native core. That core draws all twenty-eight widgets, so this list is the
# same list the native ports render, not a subset of it.
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

# @widget scrollbar
def scrollbar(ui)
  # The bar is over state you own: it knows how much there is, how much fits
  # and where you are, and nothing about what it sits beside.
  ui.text('120 lines, 8 of them on screen, starting at 36.')
  ui.scrollbar(120, viewport: 8, offset: 36, orientation: 'bottom')
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

# @widget label
def label(ui)
  # `label` is `text` in the theme's muted color: secondary copy, captions,
  # the line under a number that says what the number is.
  ui.label('cpu · 8 cores · 3.4 GHz')
  ui.text('42.1%', color: 'success', attrs: 1)
  ui.label('15 minute average')
end
# @end

# @widget heading
def heading(ui)
  # `heading` is `text` in the theme's title color, bold.
  ui.heading('Storage')
  ui.label('Four volumes, one degraded')
  ui.spacer(size: 1)
  ui.heading('Network', color: 'accent')
end
# @end

# @widget meters
def meters(ui)
  # One call for a whole bank. `columns` lays them out side by side.
  ui.meters(
    [0.12, 0.44, 0.71, 0.09, 0.38, 0.55, 0.22, 0.66].each_with_index.map { |value, i| { label: "P#{i}", value: value } },
    columns: 2, labelWidth: 4, valueWidth: 5, style: 1
  )
end
# @end

# @widget modal
def modal(ui)
  # Overlays draw over everything already on the screen, centered.
  # variant is 0 primary, 1 success, 2 warning, 3 danger, 4 ghost.
  ui.modal(
    title: 'Confirm Action',
    width: 46,
    height: 9,
    message: "Terminate process 4821 (postgres)?\n\nThis cannot be undone.",
    buttons: [
      { label: 'Yes', variant: 1, focused: true },
      { label: 'No', variant: 4 }
    ]
  )
end
# @end

# @widget commandPalette
def command_palette(ui)
  ui.command_palette(
    query: 'the',
    items: [
      { label: 'Toggle theme', hint: 'F2' },
      { label: 'Filter processes', hint: 'F3' },
      { label: 'Sort by memory', hint: 'F6' }
    ],
    selected: 0
  )
end
# @end

# @widget tooltip
def tooltip(ui)
  ui.text('Tooltips are overlays positioned at a cell, for hover and hints.')
  ui.tooltip('swap is 87% full', x: 6, y: 3)
end
# @end

EXAMPLES = {
  'text' => method(:text),
  'divider' => method(:divider),
  'keyValues' => method(:key_values),
  'table' => method(:table),
  'log' => method(:log),
  'scrollbar' => method(:scrollbar),
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
  'statusBar' => method(:status_bar),
  'label' => method(:label),
  'heading' => method(:heading),
  'meters' => method(:meters),
  'modal' => method(:modal),
  'commandPalette' => method(:command_palette),
  'tooltip' => method(:tooltip)
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
