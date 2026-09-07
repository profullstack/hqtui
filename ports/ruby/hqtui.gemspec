Gem::Specification.new do |s|
  s.name = 'hqtui'
  s.version = '0.2.0'
  s.summary = 'Ruby bindings to the HQTUI native terminal renderer'
  s.authors = ['Profullstack']
  s.homepage = 'https://hqtui.com/docs#ruby'
  s.license = 'MIT'
  s.required_ruby_version = '>= 3.1'
  s.files = Dir['lib/**/*.rb', 'examples/*.rb', 'README.md']
  s.require_paths = ['lib']
  s.add_dependency 'fiddle', '>= 1.1', '< 2'
end
