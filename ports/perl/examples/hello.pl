#!/usr/bin/env perl
use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../lib";
use Hqtui;
my $ui=Hqtui::UI->new;
$ui->panel('Perl + HQTUI',sub {
    my ($p)=@_;
    $p->text('A real Perl widget tree',color=>'primary');
    $p->meter(.72,label=>'CPU',color=>'success');
    $p->table(['Service','Status'],[['worker','running'],['queue','ready']]);
});
my $scene=Hqtui::Scene->new(width=>60,height=>12);
$scene->set($ui);
if(grep {$_ eq '--interactive'} @ARGV) {
    $scene->with_terminal(sub {
        my ($app)=@_;
        while(!$app->interrupted) {$app->present;last if index($app->poll,'q')>=0;}
    });
} else {print $scene->render;}
$scene->close;
