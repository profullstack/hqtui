#!/usr/bin/env php
<?php
require_once __DIR__ . '/../src/Hqtui.php';
exit(\Hqtui\Native::demo(array_slice($argv, 1)));
