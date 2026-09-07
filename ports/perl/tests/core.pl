use strict;
use warnings;
use utf8;
use FindBin;
use lib "$FindBin::Bin/../lib";
use Hqtui;
use Encode qw(decode);
sub check {$_[0] or die $_[1];}
sub expect_error {my($f)=@_;eval {$f->();1} and die 'Expected native error';}
my $s=Hqtui::Scene->new(width=>40,height=>8);
my $ui=Hqtui::UI->new;
$ui->panel('Custom',sub {my($p)=@_;$p->text('Perl → 世界');$p->meter(.72,label=>'CPU');$p->table(['A','B'],[['one','two']]);});
$s->set($ui);my $text=$s->render;
check(index(decode('UTF-8',$text),'Perl → 世界')>=0,'UTF-8');
check($s->render('diff') eq '','unchanged frame');
expect_error(sub {$s->set({type=>'missing'})});
check($s->render eq $text,'failed update replaced tree');
expect_error(sub {$s->resize(-1,20)});expect_error(sub {$s->render('bad-format')});
$s->resize(20,4);my @lines=split(/\n/,$s->render);check(@lines==4,'resize');
$s->close;$s->close;expect_error(sub {$s->render});
expect_error(sub {Hqtui::Scene->new(theme=>'unknown')});
print "Perl: custom widgets, UTF-8, diff, errors, resize, ownership passed\n";
