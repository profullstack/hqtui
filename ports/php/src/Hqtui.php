<?php
declare(strict_types=1);
namespace Hqtui;

final class ZendAdapter {
    public function __call(string $method, array $arguments): mixed { return \hqtui_bridge($method, ...$arguments); }
}
final class Native {
    private static ?object $api = null;
    public static function api(): object {
        if (self::$api !== null) return self::$api;
        if (extension_loaded('hqtui_native')) {
            if (\hqtui_bridge('hqb_abi_version') !== 1) throw new \RuntimeException('Unsupported native ABI');
            return self::$api = new ZendAdapter();
        }
        if (!extension_loaded('ffi')) throw new \RuntimeException('PHP FFI extension is required for HQTUI.');
        $path = getenv('HQTUI_NATIVE_LIB') ?: __DIR__ . '/../../cpp/build-bindings/libhqtui_bindings.' . (PHP_OS_FAMILY === 'Darwin' ? 'dylib' : 'so');
        if (!is_file($path)) throw new \RuntimeException('Native library missing. Build ports/cpp with -DHQTUI_BUILD_BINDINGS=ON or set HQTUI_NATIVE_LIB.');
        $api = \FFI::cdef(<<<'C'
typedef struct hqb_scene hqb_scene;
int hqb_abi_version(void);
const char *hqb_error(void);
hqb_scene *hqb_create(int, int, const char *);
void hqb_destroy(hqb_scene *);
int hqb_set(hqb_scene *, const char *, size_t);
int hqb_resize(hqb_scene *, int, int);
int hqb_collapse(hqb_scene *, int);
const char *hqb_render(hqb_scene *, const char *);
const char *hqb_demo_frame(hqb_scene *, const char *, const char *);
int hqb_open(hqb_scene *);
int hqb_present(hqb_scene *);
const char *hqb_poll(hqb_scene *, int);
int hqb_interrupted(void);
void hqb_close(hqb_scene *);
int hqb_demo(const char *, size_t);
C, $path);
        if ($api->hqb_abi_version() !== 1) throw new \RuntimeException('Unsupported native ABI');
        return self::$api = $api;
    }
    public static function check(mixed $value): mixed {
        if ($value === 0 || $value === null || ($value instanceof \FFI\CData && \FFI::isNull($value)))
            throw new \RuntimeException(self::string(self::api()->hqb_error()));
        return $value;
    }
    public static function string(mixed $value): string { return is_string($value) ? $value : \FFI::string($value); }
    public static function demo(array $arguments): int {
        $json = json_encode(array_values($arguments), JSON_THROW_ON_ERROR);
        $status = self::api()->hqb_demo($json, strlen($json));
        if ($status < 0) throw new \RuntimeException(self::string(self::api()->hqb_error()));
        return $status;
    }
}

final class UI implements \JsonSerializable {
    private array $node;
    public function __construct(string $type = 'col', array $options = []) { $this->node = ['type'=>$type, ...$options, 'children'=>[]]; }
    public function jsonSerialize(): array { return $this->node; }
    public function add(string $type, array $options = []): self { $this->node['children'][] = ['type'=>$type, ...$options]; return $this; }
    public function group(string $type, callable $body, array $options = []): self {
        $child = new self($type, $options); $body($child); $this->node['children'][] = $child; return $this;
    }
    public function row(callable $body, array $options = []): self { return $this->group('row', $body, $options); }
    public function col(callable $body, array $options = []): self { return $this->group('col', $body, $options); }
    public function panel(string $title, callable $body, array $options = []): self { return $this->group('panel', $body, ['title'=>$title, ...$options]); }
    public function text(string $text, array $options = []): self { return $this->add('text', ['text'=>$text, ...$options]); }
    public function meter(float $value, array $options = []): self { return $this->add('meter', ['value'=>$value, ...$options]); }
    public function graph(array $values, array $options = []): self { return $this->add('graph', ['values'=>$values, ...$options]); }
    public function gauge(float $value, array $options = []): self { return $this->add('gauge', ['value'=>$value, ...$options]); }
    public function table(array $columns, array $rows, array $options = []): self { return $this->add('table', ['columns'=>$columns, 'rows'=>$rows, ...$options]); }
    public function keys(array $rows, array $options = []): self { return $this->add('keys', ['rows'=>$rows, ...$options]); }
    public function log(array $entries, array $options = []): self { return $this->add('log', ['entries'=>$entries, ...$options]); }
    public function spacer(array $options = []): self { return $this->add('spacer', $options); }
    public function divider(string $text = ''): self { return $this->add('divider', ['text'=>$text]); }
    public function badge(string $text, array $o = []): self { return $this->add('badge', ['text'=>$text, ...$o]); }
    public function progress(float $value, array $o = []): self { return $this->add('progress', ['value'=>$value, ...$o]); }
    public function sparkline(array $values, array $o = []): self { return $this->add('sparkline', ['values'=>$values, ...$o]); }
    public function heatbar(float $value, array $o = []): self { return $this->add('heatbar', ['value'=>$value, ...$o]); }
    public function columns(array $values, array $o = []): self { return $this->add('columns', ['values'=>$values, ...$o]); }
    public function donut(array $segments, array $o = []): self { return $this->add('donut', ['segments'=>$segments, ...$o]); }
    public function list(array $items, array $o = []): self { return $this->add('list', ['items'=>$items, ...$o]); }
    public function tree(array $nodes, array $o = []): self { return $this->add('tree', ['nodes'=>$nodes, ...$o]); }
    public function button(string $label, array $o = []): self { return $this->add('button', ['label'=>$label, ...$o]); }
    public function checkbox(string $label, array $o = []): self { return $this->add('checkbox', ['label'=>$label, ...$o]); }
    public function select(string $value, array $o = []): self { return $this->add('select', ['value'=>$value, ...$o]); }
    public function input(string $value, array $o = []): self { return $this->add('input', ['value'=>$value, ...$o]); }
    public function tabs(array $tabs, array $o = []): self { return $this->add('tabs', ['tabs'=>$tabs, ...$o]); }
    public function statusbar(array $items, array $o = []): self { return $this->add('statusbar', ['items'=>$items, ...$o]); }
    public function label(string $text, array $o = []): self { return $this->add('label', ['text'=>$text, ...$o]); }
    public function heading(string $text, array $o = []): self { return $this->add('heading', ['text'=>$text, ...$o]); }
    public function meters(array $items, array $o = []): self { return $this->add('meters', ['items'=>$items, ...$o]); }
    // Overlays take the whole screen, so they carry no size and are drawn last.
    public function modal(array $o = []): self { return $this->add('modal', $o); }
    public function commandPalette(array $o = []): self { return $this->add('commandpalette', $o); }
    public function tooltip(string $text, int $x, int $y, array $o = []): self { return $this->add('tooltip', ['text'=>$text, 'x'=>$x, 'y'=>$y, ...$o]); }
}

final class Scene {
    private mixed $handle = null;
    private object $native;
    public function __construct(int $width=80, int $height=24, string $theme='dark') {
        $this->native = Native::api();
        $this->handle = Native::check($this->native->hqb_create($width,$height,$theme));
    }
    private function __clone() {}
    public function __serialize(): array { throw new \RuntimeException('Scenes cannot be serialized'); }
    private function handle(): mixed {
        if ($this->handle === null) throw new \RuntimeException('Scene is closed');
        return $this->handle;
    }
    public function set(UI|array $ui): self {
        $json = json_encode($ui, JSON_THROW_ON_ERROR);
        Native::check($this->native->hqb_set($this->handle(), $json, strlen($json))); return $this;
    }
    /** Merge the borders of adjacent panels into shared lines. */
    public function collapse(bool $enabled = true): self { Native::check($this->native->hqb_collapse($this->handle(),$enabled?1:0)); return $this; }
    public function resize(int $width, int $height): self { Native::check($this->native->hqb_resize($this->handle(),$width,$height)); return $this; }
    public function render(string $format='text'): string { return Native::string(Native::check($this->native->hqb_render($this->handle(),$format))); }
    public function demoFrame(string $screen, string $format='text'): string { return Native::string(Native::check($this->native->hqb_demo_frame($this->handle(),$screen,$format))); }
    public function present(): void { Native::check($this->native->hqb_present($this->handle())); }
    public function poll(int $timeoutMs=33): string { return Native::string(Native::check($this->native->hqb_poll($this->handle(),$timeoutMs))); }
    public function interrupted(): bool { return $this->native->hqb_interrupted() !== 0; }
    public function withTerminal(callable $body): mixed {
        Native::check($this->native->hqb_open($this->handle()));
        try { return $body($this); }
        finally { if ($this->handle !== null) $this->native->hqb_close($this->handle); }
    }
    public function close(): void {
        if ($this->handle !== null) { $this->native->hqb_destroy($this->handle); $this->handle=null; }
    }
    public function __destruct() { $this->close(); }
}
