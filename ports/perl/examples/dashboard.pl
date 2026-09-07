#!/usr/bin/env perl
use FindBin;
use lib "$FindBin::Bin/../lib";
use Hqtui;
exit Hqtui::demo([@ARGV]);
