/* Thin Zend adapter to the same batched C ABI used by Ruby and Perl. */
#include "hqtui_bindings.h"
#include <php.h>
static int scene_type;
typedef struct {
  hqb_scene *scene;
} scene_resource;
static void scene_free(zend_resource *resource) {
  scene_resource *r = resource->ptr;
  hqb_destroy(r->scene);
  efree(r);
}
ZEND_BEGIN_ARG_WITH_RETURN_TYPE_INFO_EX(arginfo_bridge, 0, 1, IS_MIXED, 0)
ZEND_ARG_TYPE_INFO(0, operation, IS_STRING, 0)
ZEND_ARG_VARIADIC_INFO(0, arguments)
ZEND_END_ARG_INFO()
static int is_string_arg(zval *args, int count, int index) {
  if (index >= count || Z_TYPE(args[index]) != IS_STRING) {
    zend_type_error("HQTUI expects a string argument");
    return 0;
  }
  return 1;
}
static int is_int_arg(zval *args, int count, int index) {
  if (index >= count || Z_TYPE(args[index]) != IS_LONG ||
      Z_LVAL(args[index]) < INT_MIN || Z_LVAL(args[index]) > INT_MAX) {
    zend_type_error("HQTUI expects a bounded integer argument");
    return 0;
  }
  return 1;
}
PHP_FUNCTION(hqtui_bridge) {
  char *operation;
  size_t operation_length;
  zval *args = NULL;
  int count = 0;
  ZEND_PARSE_PARAMETERS_START(1, -1)
  Z_PARAM_STRING(operation, operation_length)
  Z_PARAM_VARIADIC('*', args, count)
  ZEND_PARSE_PARAMETERS_END();
  if (!strcmp(operation, "hqb_abi_version"))
    RETURN_LONG(hqb_abi_version());
  if (!strcmp(operation, "hqb_error"))
    RETURN_STRING(hqb_error());
  if (!strcmp(operation, "hqb_interrupted"))
    RETURN_LONG(hqb_interrupted());
  if (!strcmp(operation, "hqb_demo")) {
    if (!is_string_arg(args, count, 0))
      RETURN_THROWS();
    RETURN_LONG(hqb_demo(Z_STRVAL(args[0]), Z_STRLEN(args[0])));
  }
  if (!strcmp(operation, "hqb_create")) {
    if (!is_int_arg(args, count, 0) || !is_int_arg(args, count, 1) ||
        !is_string_arg(args, count, 2))
      RETURN_THROWS();
    hqb_scene *scene = hqb_create((int)Z_LVAL(args[0]), (int)Z_LVAL(args[1]),
                                  Z_STRVAL(args[2]));
    if (!scene)
      RETURN_NULL();
    scene_resource *r = emalloc(sizeof(*r));
    r->scene = scene;
    RETURN_RES(zend_register_resource(r, scene_type));
  }
  if (!count || Z_TYPE(args[0]) != IS_RESOURCE) {
    zend_type_error("HQTUI expects a live Scene resource");
    RETURN_THROWS();
  }
  scene_resource *r =
      zend_fetch_resource(Z_RES(args[0]), "HQTUI Scene", scene_type);
  if (!r)
    RETURN_THROWS();
  if (!strcmp(operation, "hqb_destroy")) {
    hqb_destroy(r->scene);
    r->scene = NULL;
    RETURN_NULL();
  }
  if (!strcmp(operation, "hqb_close")) {
    hqb_close(r->scene);
    RETURN_NULL();
  }
  if (!r->scene) {
    zend_throw_error(NULL, "Scene is closed");
    RETURN_THROWS();
  }
  if (!strcmp(operation, "hqb_open"))
    RETURN_LONG(hqb_open(r->scene));
  if (!strcmp(operation, "hqb_present"))
    RETURN_LONG(hqb_present(r->scene));
  if (!strcmp(operation, "hqb_set")) {
    if (!is_string_arg(args, count, 1))
      RETURN_THROWS();
    RETURN_LONG(hqb_set(r->scene, Z_STRVAL(args[1]), Z_STRLEN(args[1])));
  }
  if (!strcmp(operation, "hqb_resize")) {
    if (!is_int_arg(args, count, 1) || !is_int_arg(args, count, 2))
      RETURN_THROWS();
    RETURN_LONG(
        hqb_resize(r->scene, (int)Z_LVAL(args[1]), (int)Z_LVAL(args[2])));
  }
  const char *out = NULL;
  if (!strcmp(operation, "hqb_render")) {
    if (!is_string_arg(args, count, 1))
      RETURN_THROWS();
    out = hqb_render(r->scene, Z_STRVAL(args[1]));
  } else if (!strcmp(operation, "hqb_demo_frame")) {
    if (!is_string_arg(args, count, 1) || !is_string_arg(args, count, 2))
      RETURN_THROWS();
    out = hqb_demo_frame(r->scene, Z_STRVAL(args[1]), Z_STRVAL(args[2]));
  } else if (!strcmp(operation, "hqb_poll")) {
    if (!is_int_arg(args, count, 1))
      RETURN_THROWS();
    out = hqb_poll(r->scene, (int)Z_LVAL(args[1]));
  } else {
    zend_value_error("Unknown HQTUI native operation");
    RETURN_THROWS();
  }
  if (!out)
    RETURN_NULL();
  RETURN_STRING(out);
}
static const zend_function_entry functions[] = {
    PHP_FE(hqtui_bridge, arginfo_bridge) PHP_FE_END};
PHP_MINIT_FUNCTION(hqtui_native) {
  scene_type = zend_register_list_destructors_ex(scene_free, NULL,
                                                 "HQTUI Scene", module_number);
  return SUCCESS;
}
zend_module_entry hqtui_native_module_entry = {STANDARD_MODULE_HEADER,
                                               "hqtui_native",
                                               functions,
                                               PHP_MINIT(hqtui_native),
                                               NULL,
                                               NULL,
                                               NULL,
                                               NULL,
                                               "0.1.12",
                                               STANDARD_MODULE_PROPERTIES};
ZEND_GET_MODULE(hqtui_native)
