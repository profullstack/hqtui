<?php
require_once __DIR__.'/../src/Hqtui.php';
while (($line=fgets(STDIN))!==false) {
    $c=json_decode($line,true,512,JSON_THROW_ON_ERROR);
    $s=new \Hqtui\Scene($c['width'],$c['height'],$c['theme']);
    try {
        if(isset($c['screen'])) echo $s->demoFrame($c['screen'],'hashes'),"\n";
        else { $s->set($c['tree']); echo $s->render('hashes'),"\n"; }
    } finally {$s->close();}
}
