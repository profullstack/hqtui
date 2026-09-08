require_relative '../lib/hqtui'
STDIN.each_line do |line|
  c = JSON.parse(line)
  s = Hqtui::Scene.new(width: c['width'], height: c['height'], theme: c['theme'])
  begin
    s.collapse(true) if c['collapsed']
    if c['screen']
      puts s.demo_frame(c['screen'], 'hashes')
    else
      s.set(c['tree'])
      puts s.render('hashes')
    end
  ensure
    s.close
  end
end
