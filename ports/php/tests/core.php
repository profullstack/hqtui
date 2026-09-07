<?php
require_once __DIR__.'/../src/Hqtui.php';
function check($value,$message) {if(!$value)throw new RuntimeException($message);}
function expectError($fn) {try {$fn();}catch(RuntimeException $e){return;}throw new RuntimeException('Expected native error');}
$s=new \Hqtui\Scene(40,8);
$ui=new \Hqtui\UI();
$ui->panel('Custom',function($p){$p->text('PHP → 世界');$p->meter(.72,['label'=>'CPU']);$p->table(['A','B'],[['one','two']]);});
$s->set($ui);$text=$s->render();
check(str_contains($text,'PHP → 世界'),'UTF-8');
check($s->render('diff')==='','unchanged frame');
expectError(fn()=>$s->set(['type'=>'missing']));
check($s->render()===$text,'failed update replaced tree');
expectError(fn()=>$s->resize(-1,20));expectError(fn()=>$s->render('bad-format'));
$s->resize(20,4);check(substr_count($s->render(),"\n")===4,'resize');
$s->close();$s->close();expectError(fn()=>$s->render());
expectError(fn()=>new \Hqtui\Scene(40,8,'unknown'));
echo "PHP: custom widgets, UTF-8, diff, errors, resize, ownership passed\n";
