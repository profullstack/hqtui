#!/usr/bin/env php
<?php
require_once __DIR__ . '/../src/Hqtui.php';
$ui = new \Hqtui\UI();
$ui->panel('PHP + HQTUI', function ($p) {
    $p->text('A real PHP widget tree', ['color'=>'primary']);
    $p->meter(0.72, ['label'=>'CPU', 'color'=>'success']);
    $p->table(['Service','Status'], [['worker','running'],['queue','ready']]);
});
$scene = new \Hqtui\Scene(60,12);
try {
    $scene->set($ui);
    if (in_array('--interactive', $argv, true)) {
        $scene->withTerminal(function ($app) {
            while (!$app->interrupted()) {
                $app->present();
                if (str_contains($app->poll(), 'q')) break;
            }
        });
    } else echo $scene->render();
} finally { $scene->close(); }
