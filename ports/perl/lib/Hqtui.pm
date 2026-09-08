package Hqtui;
use strict;
use warnings;
use JSON::PP ();
use FFI::Platypus 2.11;
use File::Basename qw(dirname);
use File::Spec;
our $VERSION = '0.2.0';
my $ffi;
sub native {
    return $ffi if $ffi;
    my $suffix = $^O eq 'darwin' ? 'dylib' : 'so';
    my $path = $ENV{HQTUI_NATIVE_LIB} || File::Spec->catfile(dirname(__FILE__), '../../cpp/build-bindings', "libhqtui_bindings.$suffix");
    -f $path or die "Native library missing. Build ports/cpp with -DHQTUI_BUILD_BINDINGS=ON or set HQTUI_NATIVE_LIB.\n";
    my $f = FFI::Platypus->new(api=>2, lib=>$path);
    $f->attach([hqb_abi_version=>'_abi'],[]=>'int');
    $f->attach([hqb_error=>'_error'],[]=>'string');
    $f->attach([hqb_create=>'_create'],['int','int','string']=>'opaque');
    $f->attach([hqb_destroy=>'_destroy'],['opaque']=>'void');
    $f->attach([hqb_set=>'_set'],['opaque','string','size_t']=>'int');
    $f->attach([hqb_resize=>'_resize'],['opaque','int','int']=>'int');
    $f->attach([hqb_render=>'_render'],['opaque','string']=>'string');
    $f->attach([hqb_demo_frame=>'_demo_frame'],['opaque','string','string']=>'string');
    $f->attach([hqb_open=>'_open'],['opaque']=>'int');
    $f->attach([hqb_present=>'_present'],['opaque']=>'int');
    $f->attach([hqb_poll=>'_poll'],['opaque','int']=>'string');
    $f->attach([hqb_interrupted=>'_interrupted'],[]=>'int');
    $f->attach([hqb_close=>'_close'],['opaque']=>'void');
    $f->attach([hqb_demo=>'_demo'],['string','size_t']=>'int');
    _abi()==1 or die "Unsupported native ABI\n";
    return $ffi=$f;
}
sub checked { defined $_[0] or die _error()."\n"; return $_[0]; }
sub ok { $_[0] or die _error()."\n"; return $_[0]; }
sub json { JSON::PP->new->utf8->allow_nonref->encode($_[0]); }
sub demo {
    my ($args)=@_; native(); my $json=json($args);
    my $code=_demo($json,length($json)); $code>=0 or die _error()."\n"; return $code;
}

package Hqtui::UI;
sub new { my ($class,%options)=@_; bless {type=>'col',%options,children=>[]},$class; }
sub data { my ($s)=@_; return { %$s, children=>[map {ref($_) eq __PACKAGE__ ? $_->data : $_} @{$s->{children}}]}; }
sub add { my ($s,$type,%options)=@_; push @{$s->{children}}, {type=>$type,%options}; return $s; }
sub group { my ($s,$type,$body,%options)=@_; my $child=__PACKAGE__->new(type=>$type,%options); $body->($child); push @{$s->{children}},$child; return $s; }
sub row { my ($s,$body,%o)=@_; $s->group('row',$body,%o); }
sub col { my ($s,$body,%o)=@_; $s->group('col',$body,%o); }
sub panel { my ($s,$title,$body,%o)=@_; $s->group('panel',$body,title=>$title,%o); }
sub text { my ($s,$text,%o)=@_; $s->add('text',text=>$text,%o); }
sub meter { my ($s,$value,%o)=@_; $s->add('meter',value=>$value,%o); }
sub graph { my ($s,$values,%o)=@_; $s->add('graph',values=>$values,%o); }
sub gauge { my ($s,$value,%o)=@_; $s->add('gauge',value=>$value,%o); }
sub table { my ($s,$cols,$rows,%o)=@_; $s->add('table',columns=>$cols,rows=>$rows,%o); }
sub keys { my ($s,$rows,%o)=@_; $s->add('keys',rows=>$rows,%o); }
sub log { my ($s,$entries,%o)=@_; $s->add('log',entries=>$entries,%o); }
sub spacer { my ($s,%o)=@_; $s->add('spacer',%o); }
sub divider { my ($s,$text)=@_; $s->add('divider',text=>$text//''); }
sub badge { my ($s,$text,%o)=@_; $s->add('badge',text=>$text,%o); }
sub progress { my ($s,$value,%o)=@_; $s->add('progress',value=>$value,%o); }
sub sparkline { my ($s,$values,%o)=@_; $s->add('sparkline',values=>$values,%o); }
sub heatbar { my ($s,$value,%o)=@_; $s->add('heatbar',value=>$value,%o); }
sub columns { my ($s,$values,%o)=@_; $s->add('columns',values=>$values,%o); }
sub donut { my ($s,$segments,%o)=@_; $s->add('donut',segments=>$segments,%o); }
sub list { my ($s,$items,%o)=@_; $s->add('list',items=>$items,%o); }
sub tree { my ($s,$nodes,%o)=@_; $s->add('tree',nodes=>$nodes,%o); }
sub button { my ($s,$label,%o)=@_; $s->add('button',label=>$label,%o); }
sub checkbox { my ($s,$label,%o)=@_; $s->add('checkbox',label=>$label,%o); }
sub select { my ($s,$value,%o)=@_; $s->add('select',value=>$value,%o); }
sub input { my ($s,$value,%o)=@_; $s->add('input',value=>$value,%o); }
sub tabs { my ($s,$tabs,%o)=@_; $s->add('tabs',tabs=>$tabs,%o); }
sub statusbar { my ($s,$items,%o)=@_; $s->add('statusbar',items=>$items,%o); }
sub label { my ($s,$text,%o)=@_; $s->add('label',text=>$text,%o); }
sub heading { my ($s,$text,%o)=@_; $s->add('heading',text=>$text,%o); }
sub meters { my ($s,$items,%o)=@_; $s->add('meters',items=>$items,%o); }
# Overlays take the whole screen, so they carry no size and are drawn last.
sub modal { my ($s,%o)=@_; $s->add('modal',%o); }
sub command_palette { my ($s,%o)=@_; $s->add('commandpalette',%o); }
sub tooltip { my ($s,$text,$x,$y,%o)=@_; $s->add('tooltip',text=>$text,x=>$x,y=>$y,%o); }

package Hqtui::Scene;
sub new {
    my ($class,%o)=@_; my $native=Hqtui::native();
    my $handle=Hqtui::ok(Hqtui::_create($o{width}//80,$o{height}//24,$o{theme}//'dark'));
    bless {handle=>$handle, native=>$native},$class;
}
sub handle { $_[0]->{handle} or die "Scene is closed\n"; }
sub set {
    my ($s,$ui)=@_; my $json=Hqtui::json(ref($ui) eq 'Hqtui::UI' ? $ui->data : $ui);
    Hqtui::ok(Hqtui::_set($s->handle,$json,length($json))); return $s;
}
sub resize {my ($s,$w,$h)=@_;Hqtui::ok(Hqtui::_resize($s->handle,$w,$h));return $s;}
sub render {my ($s,$format)=@_;Hqtui::checked(Hqtui::_render($s->handle,$format//'text'));}
sub demo_frame {my ($s,$screen,$format)=@_;Hqtui::checked(Hqtui::_demo_frame($s->handle,$screen,$format//'text'));}
sub present {Hqtui::ok(Hqtui::_present($_[0]->handle));}
sub poll {my ($s,$ms)=@_;Hqtui::checked(Hqtui::_poll($s->handle,$ms//33));}
sub interrupted {Hqtui::_interrupted()!=0;}
sub with_terminal {
    my ($s,$body)=@_;Hqtui::ok(Hqtui::_open($s->handle));
    my $ok=eval {$body->($s);1};my $error=$@;
    Hqtui::_close($s->{handle}) if $s->{handle};die $error unless $ok;
}
sub close {my ($s)=@_;Hqtui::_destroy(delete $s->{handle}) if $s->{handle};}
sub DESTROY {$_[0]->close;}
sub CLONE_SKIP {1;}
1;
