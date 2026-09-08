#!/usr/bin/env perl
# Every widget the Perl binding reaches, one subroutine each.
#
# `perl examples/widgets.pl` renders all of them headlessly and prints the
# result, so this file is a program rather than a snippet dump. The
# `@widget` / `@end` markers are what hqtui.com/widgets slices to show the code
# for one widget, which is why a snippet on the site is always a region of
# something that runs.
#
# Perl, Ruby and PHP all describe a scene as data and hand it to the same
# native core. That core draws all twenty-eight widgets, so this list is the
# same list the native ports render, not a subset of it.
#
# Needs the shared library: build ports/cpp with -DHQTUI_BUILD_BINDINGS=ON, or
# set HQTUI_NATIVE_LIB to one you already built.

use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../lib";
use Hqtui;

my @cpu_history = (12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41);

# @widget text
sub widget_text {
    my ($ui) = @_;
    # align is 0 left, 1 center, 2 right.
    $ui->text('Plain text. It fills the width it is given.');
    $ui->text('Centered.', align => 1);
    $ui->text('Right aligned.', align => 2);
}
# @end

# @widget divider
sub widget_divider {
    my ($ui) = @_;
    $ui->text('Above the line');
    $ui->divider;
    $ui->text('Below it');
    $ui->divider('status');
    $ui->text('A labelled divider titles a section without spending a panel on it');
}
# @end

# @widget keyValues
sub widget_key_values {
    my ($ui) = @_;
    # The backbone of every "System" panel: labels left, values right.
    $ui->keys([
        ['Host',        'web-01.iad'],
        ['Uptime',      '18d 04:12'],
        ['Load',        '0.42  0.51  0.60'],
        ['Established', '1,284'],
    ]);
}
# @end

# @widget table
sub widget_table {
    my ($ui) = @_;
    $ui->table(
        ['Name', 'Size', 'Type', 'Modified'],
        [
            ['src',          '4.2 KB', 'dir',  '2m ago'],
            ['test',         '1.1 KB', 'dir',  '5m ago'],
            ['package.json', '1.2 KB', 'file', '10m ago'],
            ['README.md',    '3.4 KB', 'file', '1h ago'],
        ],
        selected => 1,
    );
}
# @end

# @widget log
sub widget_log {
    my ($ui) = @_;
    $ui->log([
        { time => '12:45:02', level => 'INFO',  message => 'listening on :8080' },
        { time => '12:45:09', level => 'WARN',  message => 'slow query 412ms', meta => 'table=users' },
        { time => '12:45:11', level => 'ERROR', message => 'upstream timeout' },
        { time => '12:45:14', level => 'INFO',  message => 'retry succeeded' },
    ]);
}
# @end

# @widget meter
sub widget_meter {
    my ($ui) = @_;
    $ui->meter(0.62, label => 'CPU');
    $ui->meter(0.31, label => 'MEM');
    $ui->meter(0.87, label => 'SWP');
}
# @end

# @widget graph
sub widget_graph {
    my ($ui) = @_;
    # Braille line chart, filled under the curve.
    $ui->graph(\@cpu_history, min => 0, max => 100);
}
# @end

# @widget gauge
sub widget_gauge {
    my ($ui) = @_;
    # A semicircular dial. Wants at least nine columns by five rows.
    $ui->gauge(0.62, label => '62%');
}
# @end

# @widget badge
sub widget_badge {
    my ($ui) = @_;
    $ui->badge('active');
}
# @end

# @widget progress
sub widget_progress {
    my ($ui) = @_;
    $ui->progress(37, max => 120, label => 'Indexing', count => \1);
    $ui->progress(0.82, label => 'Upload');
}
# @end

# @widget sparkline
sub widget_sparkline {
    my ($ui) = @_;
    $ui->sparkline(\@cpu_history, label => 'CPU ', text => '44%');
}
# @end

# @widget heatBar
sub widget_heat_bar {
    my ($ui) = @_;
    $ui->heatbar(0.28);
    $ui->heatbar(0.64);
    $ui->heatbar(0.91);
}
# @end

# @widget histogram
sub widget_histogram {
    my ($ui) = @_;
    # Block columns. Cheaper than Braille and easier to read when short.
    $ui->columns(\@cpu_history);
}
# @end

# @widget donut
sub widget_donut {
    my ($ui) = @_;
    $ui->donut([{ value => 4.65, label => 'Used' }, { value => 10.96, label => 'Free' }]);
}
# @end

# @widget list
sub widget_list {
    my ($ui) = @_;
    $ui->list(['apps/demo', 'packages/hqtui', 'apps/web', 'docs'], selected => 0, bullet => '▸');
}
# @end

# @widget tree
sub widget_tree {
    my ($ui) = @_;
    $ui->tree([{ label => 'systemd', children => [{ label => 'bash' }, { label => 'postgres' }] }],
              selected => 1);
}
# @end

# @widget button
sub widget_button {
    my ($ui) = @_;
    # variant: 0 primary, 1 success, 2 warning, 3 danger, 4 ghost.
    $ui->button('Primary');
}
# @end

# @widget checkbox
sub widget_checkbox {
    my ($ui) = @_;
    $ui->checkbox('Toggle', checked => \1, variant => 1);
    $ui->checkbox('Checkbox', checked => \0);
}
# @end

# @widget select
sub widget_select {
    my ($ui) = @_;
    $ui->select('Dracula', open => \1, options => ['Dark', 'Dracula', 'Nord'], selected => 1);
}
# @end

# @widget textInput
sub widget_text_input {
    my ($ui) = @_;
    $ui->input('postgres', label => 'Search');
}
# @end

# @widget tabs
sub widget_tabs {
    my ($ui) = @_;
    $ui->tabs(['1 dashboard', '2 traffic', '3 sessions'], active => 1);
}
# @end

# @widget statusBar
sub widget_status_bar {
    my ($ui) = @_;
    $ui->statusbar([{ key => 'F1', label => 'Help' }, { key => 'q', label => 'Quit' }],
                   right => [{ label => '0.41ms' }]);
}
# @end

# @widget label
sub widget_label {
    my ($ui) = @_;
    # `label` is `text` in the theme's muted color: secondary copy, captions,
    # the line under a number that says what the number is.
    $ui->label('cpu · 8 cores · 3.4 GHz');
    $ui->text('42.1%', color => 'success', attrs => 1);
    $ui->label('15 minute average');
}
# @end

# @widget heading
sub widget_heading {
    my ($ui) = @_;
    # `heading` is `text` in the theme's title color, bold.
    $ui->heading('Storage');
    $ui->label('Four volumes, one degraded');
    $ui->spacer(size => 1);
    $ui->heading('Network', color => 'accent');
}
# @end

# @widget meters
sub widget_meters {
    my ($ui) = @_;
    # One call for a whole bank. `columns` lays them out side by side.
    my @values = (0.12, 0.44, 0.71, 0.09, 0.38, 0.55, 0.22, 0.66);
    my @items = map { { label => "P$_", value => $values[$_] } } 0 .. $#values;
    $ui->meters(\@items, columns => 2, labelWidth => 4, valueWidth => 5, style => 1);
}
# @end

# @widget modal
sub widget_modal {
    my ($ui) = @_;
    # Overlays draw over everything already on the screen, centered.
    # variant is 0 primary, 1 success, 2 warning, 3 danger, 4 ghost.
    $ui->modal(
        title   => 'Confirm Action',
        width   => 46,
        height  => 9,
        message => "Terminate process 4821 (postgres)?\n\nThis cannot be undone.",
        buttons => [
            { label => 'Yes', variant => 1, focused => \1 },
            { label => 'No',  variant => 4 },
        ],
    );
}
# @end

# @widget commandPalette
sub widget_command_palette {
    my ($ui) = @_;
    $ui->command_palette(
        query => 'the',
        items => [
            { label => 'Toggle theme',     hint => 'F2' },
            { label => 'Filter processes', hint => 'F3' },
            { label => 'Sort by memory',   hint => 'F6' },
        ],
        selected => 0,
    );
}
# @end

# @widget tooltip
sub widget_tooltip {
    my ($ui) = @_;
    $ui->text('Tooltips are overlays positioned at a cell, for hover and hints.');
    $ui->tooltip('swap is 87% full', 6, 3);
}
# @end

my @examples = (
    ['text',      \&widget_text],
    ['divider',   \&widget_divider],
    ['keyValues', \&widget_key_values],
    ['table',     \&widget_table],
    ['log',       \&widget_log],
    ['meter',     \&widget_meter],
    ['graph',     \&widget_graph],
    ['gauge',     \&widget_gauge],
    ['badge', \&widget_badge],
    ['progress', \&widget_progress],
    ['sparkline', \&widget_sparkline],
    ['heatBar', \&widget_heat_bar],
    ['histogram', \&widget_histogram],
    ['donut', \&widget_donut],
    ['list', \&widget_list],
    ['tree', \&widget_tree],
    ['button', \&widget_button],
    ['checkbox', \&widget_checkbox],
    ['select', \&widget_select],
    ['textInput', \&widget_text_input],
    ['tabs', \&widget_tabs],
    ['statusBar', \&widget_status_bar],
    ['label', \&widget_label],
    ['heading', \&widget_heading],
    ['meters', \&widget_meters],
    ['modal', \&widget_modal],
    ['commandPalette', \&widget_command_palette],
    ['tooltip', \&widget_tooltip],
);

# Renders each widget on its own small screen and prints the lot.
my $blank = 0;
for my $example (@examples) {
    my ($name, $draw) = @$example;
    my $ui = Hqtui::UI->new;
    $draw->($ui);
    my $scene = Hqtui::Scene->new(width => 62, height => 12, theme => 'dark');
    my $rendered = $scene->set($ui)->render('text');
    if ($rendered !~ /\S/) {
        print STDERR "FAIL $name: rendered an empty screen\n";
        $blank++;
        next;
    }
    $rendered =~ s/\s+\z//;
    print "--- $name\n$rendered\n";
}

printf STDERR "%d/%d widget examples rendered\n", scalar(@examples) - $blank, scalar(@examples);
exit($blank == 0 ? 0 : 1);
