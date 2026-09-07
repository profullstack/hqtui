#!/usr/bin/env ruby
require_relative '../lib/hqtui'
ui = Hqtui::UI.new
ui.panel('Ruby + HQTUI') do |p|
  p.text('A real Ruby widget tree', color: 'primary')
  p.meter(0.72, label: 'CPU', color: 'success')
  p.table(['Service', 'Status'], [['worker', 'running'], ['queue', 'ready']])
end
scene = Hqtui::Scene.new(width: 60, height: 12)
begin
  scene.set(ui)
  if ARGV.include?('--interactive')
    scene.with_terminal do |app|
      until app.interrupted?
        app.present
        break if app.poll.include?('q')
      end
    end
  else
    print scene.render
  end
ensure
  scene.close
end
