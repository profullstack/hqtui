use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../lib";
use Hqtui;
while(my $line=<STDIN>) {
    my $c=JSON::PP->new->utf8->decode($line);
    my $s=Hqtui::Scene->new(width=>$c->{width},height=>$c->{height},theme=>$c->{theme});
    if($c->{screen}) {print $s->demo_frame($c->{screen},'hashes'),"\n";}
    else {$s->set($c->{tree});print $s->render('hashes'),"\n";}
    $s->close;
}
