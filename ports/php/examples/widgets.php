<?php
/**
 * Every widget the PHP binding reaches, one function each.
 *
 * `php examples/widgets.php` renders all of them headlessly and prints the
 * result, so this file is a program rather than a snippet dump. The
 * `@widget` / `@end` markers are what hqtui.com/widgets slices to show the code
 * for one widget, which is why a snippet on the site is always a region of
 * something that runs.
 *
 * PHP, Ruby and Perl all describe a scene as data and hand it to the same
 * native core, so they reach the eight widgets that core draws rather than the
 * twenty-eight the native ports do. The list is honest about that.
 *
 * Needs the shared library: build ports/cpp with -DHQTUI_BUILD_BINDINGS=ON, or
 * set HQTUI_NATIVE_LIB to one you already built.
 */

declare(strict_types=1);

require_once __DIR__ . '/../src/Hqtui.php';

use Hqtui\Scene;
use Hqtui\UI;

const CPU_HISTORY = [12, 18, 26, 22, 31, 44, 38, 52, 61, 48, 39, 44, 57, 66, 72, 64, 51, 43, 37, 41];

// @widget text
function widget_text(UI $ui): void
{
    // align is 0 left, 1 center, 2 right.
    $ui->text('Plain text. It fills the width it is given.');
    $ui->text('Centered.', ['align' => 1]);
    $ui->text('Right aligned.', ['align' => 2]);
}
// @end

// @widget divider
function widget_divider(UI $ui): void
{
    $ui->text('Above the line');
    $ui->divider();
    $ui->text('Below it');
    $ui->divider('status');
    $ui->text('A labelled divider titles a section without spending a panel on it');
}
// @end

// @widget keyValues
function widget_key_values(UI $ui): void
{
    // The backbone of every "System" panel: labels left, values right.
    $ui->keys([
        ['Host', 'web-01.iad'],
        ['Uptime', '18d 04:12'],
        ['Load', '0.42  0.51  0.60'],
        ['Established', '1,284'],
    ]);
}
// @end

// @widget table
function widget_table(UI $ui): void
{
    $ui->table(
        ['Name', 'Size', 'Type', 'Modified'],
        [
            ['src', '4.2 KB', 'dir', '2m ago'],
            ['test', '1.1 KB', 'dir', '5m ago'],
            ['package.json', '1.2 KB', 'file', '10m ago'],
            ['README.md', '3.4 KB', 'file', '1h ago'],
        ],
        ['selected' => 1],
    );
}
// @end

// @widget log
function widget_log(UI $ui): void
{
    $ui->log([
        ['time' => '12:45:02', 'level' => 'INFO', 'message' => 'listening on :8080'],
        ['time' => '12:45:09', 'level' => 'WARN', 'message' => 'slow query 412ms', 'meta' => 'table=users'],
        ['time' => '12:45:11', 'level' => 'ERROR', 'message' => 'upstream timeout'],
        ['time' => '12:45:14', 'level' => 'INFO', 'message' => 'retry succeeded'],
    ]);
}
// @end

// @widget meter
function widget_meter(UI $ui): void
{
    $ui->meter(0.62, ['label' => 'CPU']);
    $ui->meter(0.31, ['label' => 'MEM']);
    $ui->meter(0.87, ['label' => 'SWP']);
}
// @end

// @widget graph
function widget_graph(UI $ui): void
{
    // Braille line chart, filled under the curve.
    $ui->graph(CPU_HISTORY, ['min' => 0, 'max' => 100]);
}
// @end

// @widget gauge
function widget_gauge(UI $ui): void
{
    // A semicircular dial. Wants at least nine columns by five rows.
    $ui->gauge(0.62, ['label' => '62%']);
}
// @end

// @widget badge
function widget_badge(UI $ui): void
{
    $ui->badge('active');
}
// @end

// @widget progress
function widget_progress(UI $ui): void
{
    $ui->progress(37, ['max' => 120, 'label' => 'Indexing', 'count' => true]);
    $ui->progress(0.82, ['label' => 'Upload']);
}
// @end

// @widget sparkline
function widget_sparkline(UI $ui): void
{
    $ui->sparkline(CPU_HISTORY, ['label' => 'CPU ', 'text' => '44%']);
}
// @end

// @widget heatBar
function widget_heat_bar(UI $ui): void
{
    $ui->heatbar(0.28);
    $ui->heatbar(0.64);
    $ui->heatbar(0.91);
}
// @end

// @widget histogram
function widget_histogram(UI $ui): void
{
    // Block columns. Cheaper than Braille and easier to read when short.
    $ui->columns(CPU_HISTORY);
}
// @end

// @widget donut
function widget_donut(UI $ui): void
{
    $ui->donut([['value' => 4.65, 'label' => 'Used'], ['value' => 10.96, 'label' => 'Free']]);
}
// @end

// @widget list
function widget_list(UI $ui): void
{
    $ui->list(['apps/demo', 'packages/hqtui', 'apps/web', 'docs'], ['selected' => 0, 'bullet' => '▸']);
}
// @end

// @widget tree
function widget_tree(UI $ui): void
{
    $ui->tree([['label' => 'systemd', 'children' => [['label' => 'bash'], ['label' => 'postgres']]]], ['selected' => 1]);
}
// @end

// @widget button
function widget_button(UI $ui): void
{
    // variant: 0 primary, 1 success, 2 warning, 3 danger, 4 ghost.
    $ui->button('Primary');
}
// @end

// @widget checkbox
function widget_checkbox(UI $ui): void
{
    $ui->checkbox('Toggle', ['checked' => true, 'variant' => 1]);
    $ui->checkbox('Checkbox', ['checked' => false]);
}
// @end

// @widget select
function widget_select(UI $ui): void
{
    $ui->select('Dracula', ['open' => true, 'options' => ['Dark', 'Dracula', 'Nord'], 'selected' => 1]);
}
// @end

// @widget textInput
function widget_text_input(UI $ui): void
{
    $ui->input('postgres', ['label' => 'Search']);
}
// @end

// @widget tabs
function widget_tabs(UI $ui): void
{
    $ui->tabs(['1 dashboard', '2 traffic', '3 sessions'], ['active' => 1]);
}
// @end

// @widget statusBar
function widget_status_bar(UI $ui): void
{
    $ui->statusbar([['key' => 'F1', 'label' => 'Help'], ['key' => 'q', 'label' => 'Quit']],
        ['right' => [['label' => '0.41ms']]]);
}
// @end

$examples = [
    'text' => 'widget_text',
    'divider' => 'widget_divider',
    'keyValues' => 'widget_key_values',
    'table' => 'widget_table',
    'log' => 'widget_log',
    'meter' => 'widget_meter',
    'graph' => 'widget_graph',
    'gauge' => 'widget_gauge',
    'badge' => 'widget_badge',
    'progress' => 'widget_progress',
    'sparkline' => 'widget_sparkline',
    'heatBar' => 'widget_heat_bar',
    'histogram' => 'widget_histogram',
    'donut' => 'widget_donut',
    'list' => 'widget_list',
    'tree' => 'widget_tree',
    'button' => 'widget_button',
    'checkbox' => 'widget_checkbox',
    'select' => 'widget_select',
    'textInput' => 'widget_text_input',
    'tabs' => 'widget_tabs',
    'statusBar' => 'widget_status_bar',
];

// Renders each widget on its own small screen and prints the lot.
$blank = 0;
foreach ($examples as $name => $draw) {
    $ui = new UI();
    $draw($ui);
    $scene = new Scene(62, 12, 'dark');
    $rendered = $scene->set($ui)->render('text');
    if (trim($rendered) === '') {
        fwrite(STDERR, "FAIL {$name}: rendered an empty screen\n");
        $blank++;
        continue;
    }
    echo "--- {$name}\n" . rtrim($rendered) . "\n";
}

$total = count($examples);
fwrite(STDERR, ($total - $blank) . "/{$total} widget examples rendered\n");
exit($blank === 0 ? 0 : 1);
