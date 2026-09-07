require_relative '../lib/hqtui'
def expect_error
  begin; yield; rescue Hqtui::Error; return; end
  raise 'Expected a native error'
end
s=Hqtui::Scene.new(width:40,height:8)
ui=Hqtui::UI.new
ui.panel('Custom') { |p| p.text('Ruby → 世界'); p.meter(0.72,label:'CPU'); p.table(['A','B'],[['one','two']]) }
s.set(ui)
text=s.render
raise 'UTF-8' unless text.include?('Ruby → 世界')
raise 'unchanged frame' unless s.render('diff').empty?
expect_error {s.set({type:'missing'})}
raise 'failed update replaced tree' unless s.render == text
expect_error {s.resize(-1,20)}
expect_error {s.render('bad-format')}
raise 'borrowed output was mutated' unless text.include?('Ruby → 世界')
s.resize(20,4)
raise 'resize' unless s.render.lines.length==4
s.close;s.close
expect_error {s.render}
expect_error {Hqtui::Scene.new(theme:'unknown')}
puts 'Ruby: custom widgets, UTF-8, diff, errors, resize, ownership passed'
