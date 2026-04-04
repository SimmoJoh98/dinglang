export const C_ARENA = `\
// ── Arena allocator ─────────────────────────────────────────────────

#define DING_ARENA_SIZE (256 * 1024 * 1024)

typedef struct {
  uint8_t* base;
  size_t   offset;
  size_t   capacity;
} DingArena;

static DingArena __ding_arena;

void ding_arena_init() {
  __ding_arena.base     = (uint8_t*)malloc(DING_ARENA_SIZE);
  __ding_arena.offset   = 0;
  __ding_arena.capacity = DING_ARENA_SIZE;
  if (!__ding_arena.base) {
    fprintf(stderr, "Ding: failed to initialize arena\\n");
    exit(1);
  }
}

void* ding_alloc(size_t size) {
  size = (size + 7) & ~7;
  if (__ding_arena.offset + size > __ding_arena.capacity) {
    fprintf(stderr, "Ding: arena out of memory\\n");
    exit(1);
  }
  void* ptr = __ding_arena.base + __ding_arena.offset;
  __ding_arena.offset += size;
  return ptr;
}

void ding_arena_free() {
  free(__ding_arena.base);
}

// ── String helpers ──────────────────────────────────────────────────

ding_string ding_string_concat(ding_string a, ding_string b) {
  size_t len = strlen(a) + strlen(b) + 1;
  ding_string result = (ding_string)ding_alloc(len);
  strcpy(result, a);
  strcat(result, b);
  return result;
}

ding_string ding_int_to_string(ding_int n) {
  ding_string buf = (ding_string)ding_alloc(32);
  snprintf(buf, 32, "%lld", (long long)n);
  return buf;
}

ding_string ding_float_to_string(ding_float n) {
  ding_string buf = (ding_string)ding_alloc(64);
  snprintf(buf, 64, "%g", n);
  return buf;
}

ding_string ding_bool_to_string(ding_bool b) {
  return b ? "true" : "false";
}

ding_string ding_value_to_string(DingValue v) {
  switch (v.type) {
    case DING_NULL:   return "null";
    case DING_INT:    return ding_int_to_string(v.as_int);
    case DING_FLOAT:  return ding_float_to_string(v.as_float);
    case DING_BOOL:   return ding_bool_to_string(v.as_bool);
    case DING_STRING: return v.as_string;
    default:          return "[object]";
  }
}

// ── Array helpers ───────────────────────────────────────────────────

DingArray* ding_array_new() {
  DingArray* arr = (DingArray*)ding_alloc(sizeof(DingArray));
  arr->capacity  = 8;
  arr->length    = 0;
  arr->items     = (DingValue*)ding_alloc(sizeof(DingValue) * 8);
  return arr;
}

void ding_array_push(DingArray* arr, DingValue val) {
  if (arr->length >= arr->capacity) {
    ding_int new_cap = arr->capacity * 2;
    DingValue* new_items = (DingValue*)ding_alloc(sizeof(DingValue) * new_cap);
    memcpy(new_items, arr->items, sizeof(DingValue) * arr->length);
    arr->items    = new_items;
    arr->capacity = new_cap;
  }
  arr->items[arr->length++] = val;
}

DingValue ding_array_get(DingArray* arr, ding_int idx) {
  if (idx < 0 || idx >= arr->length) {
    fprintf(stderr, "Ding: array index %lld out of bounds\\n",
            (long long)idx);
    exit(1);
  }
  return arr->items[idx];
}
`;
