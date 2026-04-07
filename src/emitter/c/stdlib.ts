export const C_STDLIB_STD = `\
// ── ding:std ────────────────────────────────────────────────────────

void ding_log(DingValue val) {
  printf("%s\\n", ding_value_to_string(val));
}

void ding_warn(DingValue val) {
  fprintf(stderr, "warn: %s\\n", ding_value_to_string(val));
}

void ding_error(DingValue val) {
  fprintf(stderr, "error: %s\\n", ding_value_to_string(val));
}

void ding_assert(ding_bool cond, ding_string msg) {
  if (!cond) {
    fprintf(stderr, "Assertion failed: %s\\n", msg);
    exit(1);
  }
}
`;

export const C_STDLIB_MATH = `\
// ── ding:math ───────────────────────────────────────────────────────

ding_float ding_math_floor(ding_float n) { return floor(n); }
ding_float ding_math_ceil(ding_float n)  { return ceil(n); }
ding_float ding_math_round(ding_float n) { return round(n); }
ding_float ding_math_abs(ding_float n)   { return fabs(n); }
ding_float ding_math_min(ding_float a, ding_float b) { return a < b ? a : b; }
ding_float ding_math_max(ding_float a, ding_float b) { return a > b ? a : b; }
ding_float ding_math_pow(ding_float a, ding_float b) { return pow(a, b); }
ding_float ding_math_sqrt(ding_float n) { return sqrt(n); }
`;

export const C_STRING_METHODS = `\
// ── String methods ─────────────────────────────────────────────────

ding_bool ding_value_equals(DingValue a, DingValue b) {
  if (a.type != b.type) return false;
  switch (a.type) {
    case DING_NULL:   return true;
    case DING_INT:    return a.as_int == b.as_int;
    case DING_FLOAT:  return a.as_float == b.as_float;
    case DING_BOOL:   return a.as_bool == b.as_bool;
    case DING_STRING: return strcmp(a.as_string, b.as_string) == 0;
    default:          return false;
  }
}

ding_int ding_string_length(ding_string s) {
  return (ding_int)strlen(s);
}

ding_int ding_string_indexOf(ding_string s, ding_string needle) {
  char* p = strstr(s, needle);
  if (!p) return -1;
  return (ding_int)(p - s);
}

ding_bool ding_string_includes(ding_string s, ding_string needle) {
  return strstr(s, needle) != NULL;
}

ding_bool ding_string_startsWith(ding_string s, ding_string prefix) {
  size_t plen = strlen(prefix);
  return strncmp(s, prefix, plen) == 0;
}

ding_bool ding_string_endsWith(ding_string s, ding_string suffix) {
  size_t slen = strlen(s);
  size_t suflen = strlen(suffix);
  if (suflen > slen) return false;
  return strcmp(s + slen - suflen, suffix) == 0;
}

ding_string ding_string_slice(ding_string s, ding_int start, ding_int end) {
  ding_int len = (ding_int)strlen(s);
  if (start < 0) start = 0;
  if (end > len) end = len;
  if (start >= end) {
    ding_string empty = (ding_string)ding_alloc(1);
    empty[0] = '\\0';
    return empty;
  }
  ding_int rlen = end - start;
  ding_string result = (ding_string)ding_alloc(rlen + 1);
  memcpy(result, s + start, rlen);
  result[rlen] = '\\0';
  return result;
}

ding_string ding_string_trim(ding_string s) {
  while (*s == ' ' || *s == '\\t' || *s == '\\n' || *s == '\\r') s++;
  size_t len = strlen(s);
  while (len > 0 && (s[len-1] == ' ' || s[len-1] == '\\t' || s[len-1] == '\\n' || s[len-1] == '\\r')) len--;
  ding_string result = (ding_string)ding_alloc(len + 1);
  memcpy(result, s, len);
  result[len] = '\\0';
  return result;
}

ding_string ding_string_toUpperCase(ding_string s) {
  size_t len = strlen(s);
  ding_string result = (ding_string)ding_alloc(len + 1);
  for (size_t i = 0; i < len; i++) {
    result[i] = (s[i] >= 'a' && s[i] <= 'z') ? s[i] - 32 : s[i];
  }
  result[len] = '\\0';
  return result;
}

ding_string ding_string_toLowerCase(ding_string s) {
  size_t len = strlen(s);
  ding_string result = (ding_string)ding_alloc(len + 1);
  for (size_t i = 0; i < len; i++) {
    result[i] = (s[i] >= 'A' && s[i] <= 'Z') ? s[i] + 32 : s[i];
  }
  result[len] = '\\0';
  return result;
}

DingArray* ding_string_split(ding_string s, ding_string delim) {
  DingArray* arr = ding_array_new();
  size_t dlen = strlen(delim);
  if (dlen == 0) {
    // Split by character
    size_t slen = strlen(s);
    for (size_t i = 0; i < slen; i++) {
      ding_string ch = (ding_string)ding_alloc(2);
      ch[0] = s[i];
      ch[1] = '\\0';
      ding_array_push(arr, (DingValue){ .type = DING_STRING, .as_string = ch });
    }
    return arr;
  }
  char* start = s;
  char* found;
  while ((found = strstr(start, delim)) != NULL) {
    ding_int len = (ding_int)(found - start);
    ding_string part = (ding_string)ding_alloc(len + 1);
    memcpy(part, start, len);
    part[len] = '\\0';
    ding_array_push(arr, (DingValue){ .type = DING_STRING, .as_string = part });
    start = found + dlen;
  }
  // Remainder
  size_t rlen = strlen(start);
  ding_string rest = (ding_string)ding_alloc(rlen + 1);
  memcpy(rest, start, rlen + 1);
  ding_array_push(arr, (DingValue){ .type = DING_STRING, .as_string = rest });
  return arr;
}

ding_string ding_string_repeat(ding_string s, ding_int n) {
  if (n <= 0) {
    ding_string empty = (ding_string)ding_alloc(1);
    empty[0] = '\\0';
    return empty;
  }
  size_t slen = strlen(s);
  size_t total = slen * n;
  ding_string result = (ding_string)ding_alloc(total + 1);
  for (ding_int i = 0; i < n; i++) {
    memcpy(result + i * slen, s, slen);
  }
  result[total] = '\\0';
  return result;
}

ding_string ding_string_replace(ding_string s, ding_string old, ding_string new_str) {
  char* found = strstr(s, old);
  if (!found) {
    size_t len = strlen(s);
    ding_string result = (ding_string)ding_alloc(len + 1);
    memcpy(result, s, len + 1);
    return result;
  }
  size_t prefix_len = found - s;
  size_t old_len = strlen(old);
  size_t new_len = strlen(new_str);
  size_t suffix_len = strlen(found + old_len);
  size_t total = prefix_len + new_len + suffix_len;
  ding_string result = (ding_string)ding_alloc(total + 1);
  memcpy(result, s, prefix_len);
  memcpy(result + prefix_len, new_str, new_len);
  memcpy(result + prefix_len + new_len, found + old_len, suffix_len + 1);
  return result;
}
`;

/** Map of string method names to their C function names */
export const C_STRING_METHOD_MAP: Record<string, { cName: string; returnType: string }> = {
  indexOf: { cName: "ding_string_indexOf", returnType: "ding_int" },
  includes: { cName: "ding_string_includes", returnType: "ding_bool" },
  startsWith: { cName: "ding_string_startsWith", returnType: "ding_bool" },
  endsWith: { cName: "ding_string_endsWith", returnType: "ding_bool" },
  slice: { cName: "ding_string_slice", returnType: "ding_string" },
  trim: { cName: "ding_string_trim", returnType: "ding_string" },
  toUpperCase: { cName: "ding_string_toUpperCase", returnType: "ding_string" },
  toLowerCase: { cName: "ding_string_toLowerCase", returnType: "ding_string" },
  split: { cName: "ding_string_split", returnType: "DingArray*" },
  replace: { cName: "ding_string_replace", returnType: "ding_string" },
};

export const C_MAP_RUNTIME = `\
// ── Map runtime (hash table, string keys) ─────────────────────────

static ding_int ding_map_hash(ding_string key, ding_int capacity) {
  unsigned long hash = 5381;
  int c;
  while ((c = *key++)) {
    hash = ((hash << 5) + hash) + c;
  }
  return (ding_int)(hash % (unsigned long)capacity);
}

DingMap* ding_map_new() {
  DingMap* map = (DingMap*)ding_alloc(sizeof(DingMap));
  map->capacity = 16;
  map->length = 0;
  map->buckets = (DingMapEntry*)ding_alloc(sizeof(DingMapEntry) * map->capacity);
  memset(map->buckets, 0, sizeof(DingMapEntry) * map->capacity);
  return map;
}

static void ding_map_resize(DingMap* map) {
  ding_int old_cap = map->capacity;
  DingMapEntry* old_buckets = map->buckets;
  map->capacity = old_cap * 2;
  map->buckets = (DingMapEntry*)ding_alloc(sizeof(DingMapEntry) * map->capacity);
  memset(map->buckets, 0, sizeof(DingMapEntry) * map->capacity);
  map->length = 0;
  for (ding_int i = 0; i < old_cap; i++) {
    if (old_buckets[i].occupied) {
      ding_int idx = ding_map_hash(old_buckets[i].key, map->capacity);
      while (map->buckets[idx].occupied) {
        idx = (idx + 1) % map->capacity;
      }
      map->buckets[idx].key = old_buckets[i].key;
      map->buckets[idx].value = old_buckets[i].value;
      map->buckets[idx].occupied = true;
      map->length++;
    }
  }
}

void ding_map_set(DingMap* map, ding_string key, DingValue value) {
  if (map->length * 4 >= map->capacity * 3) {
    ding_map_resize(map);
  }
  ding_int idx = ding_map_hash(key, map->capacity);
  while (map->buckets[idx].occupied) {
    if (strcmp(map->buckets[idx].key, key) == 0) {
      map->buckets[idx].value = value;
      return;
    }
    idx = (idx + 1) % map->capacity;
  }
  map->buckets[idx].key = key;
  map->buckets[idx].value = value;
  map->buckets[idx].occupied = true;
  map->length++;
}

DingValue ding_map_get(DingMap* map, ding_string key) {
  ding_int idx = ding_map_hash(key, map->capacity);
  while (map->buckets[idx].occupied) {
    if (strcmp(map->buckets[idx].key, key) == 0) {
      return map->buckets[idx].value;
    }
    idx = (idx + 1) % map->capacity;
  }
  return DING_VALUE_NULL;
}

ding_bool ding_map_has(DingMap* map, ding_string key) {
  ding_int idx = ding_map_hash(key, map->capacity);
  while (map->buckets[idx].occupied) {
    if (strcmp(map->buckets[idx].key, key) == 0) return true;
    idx = (idx + 1) % map->capacity;
  }
  return false;
}

void ding_map_delete(DingMap* map, ding_string key) {
  ding_int idx = ding_map_hash(key, map->capacity);
  while (map->buckets[idx].occupied) {
    if (strcmp(map->buckets[idx].key, key) == 0) {
      map->buckets[idx].occupied = false;
      map->length--;
      // Rehash subsequent entries in the cluster
      ding_int next = (idx + 1) % map->capacity;
      while (map->buckets[next].occupied) {
        DingMapEntry entry = map->buckets[next];
        map->buckets[next].occupied = false;
        map->length--;
        ding_map_set(map, entry.key, entry.value);
        next = (next + 1) % map->capacity;
      }
      return;
    }
    idx = (idx + 1) % map->capacity;
  }
}

DingArray* ding_map_keys(DingMap* map) {
  DingArray* arr = ding_array_new();
  for (ding_int i = 0; i < map->capacity; i++) {
    if (map->buckets[i].occupied) {
      ding_array_push(arr, (DingValue){.type=DING_STRING, .as_string=map->buckets[i].key});
    }
  }
  return arr;
}

DingArray* ding_map_values(DingMap* map) {
  DingArray* arr = ding_array_new();
  for (ding_int i = 0; i < map->capacity; i++) {
    if (map->buckets[i].occupied) {
      ding_array_push(arr, map->buckets[i].value);
    }
  }
  return arr;
}
`;

export const C_STDLIB_IO = `\
// ── ding:io ────────────────────────────────────────────────────────

static int __ding_argc = 0;
static char** __ding_argv = NULL;

ding_string ding_io_readFile(ding_string path) {
  FILE* f = fopen(path, "r");
  if (!f) {
    fprintf(stderr, "Ding: cannot open file: %s\\n", path);
    exit(1);
  }
  fseek(f, 0, SEEK_END);
  long len = ftell(f);
  fseek(f, 0, SEEK_SET);
  ding_string buf = (ding_string)ding_alloc(len + 1);
  size_t __r = fread(buf, 1, len, f); (void)__r;
  buf[len] = '\\0';
  fclose(f);
  return buf;
}

void ding_io_writeFile(ding_string path, ding_string data) {
  FILE* f = fopen(path, "w");
  if (!f) {
    fprintf(stderr, "Ding: cannot write file: %s\\n", path);
    exit(1);
  }
  fwrite(data, 1, strlen(data), f);
  fclose(f);
}

void ding_io_appendFile(ding_string path, ding_string data) {
  FILE* f = fopen(path, "a");
  if (!f) {
    fprintf(stderr, "Ding: cannot open file for append: %s\\n", path);
    exit(1);
  }
  fwrite(data, 1, strlen(data), f);
  fclose(f);
}

ding_string ding_io_readLine() {
  ding_string buf = (ding_string)ding_alloc(4096);
  if (!fgets(buf, 4096, stdin)) {
    buf[0] = '\\0';
    return buf;
  }
  size_t len = strlen(buf);
  if (len > 0 && buf[len - 1] == '\\n') buf[len - 1] = '\\0';
  return buf;
}

DingArray* ding_io_args() {
  DingArray* arr = ding_array_new();
  for (int i = 0; i < __ding_argc; i++) {
    size_t len = strlen(__ding_argv[i]);
    ding_string s = (ding_string)ding_alloc(len + 1);
    memcpy(s, __ding_argv[i], len + 1);
    ding_array_push(arr, (DingValue){.type=DING_STRING, .as_string=s});
  }
  return arr;
}

ding_bool ding_io_exists(ding_string path) {
  FILE* f = fopen(path, "r");
  if (f) { fclose(f); return true; }
  return false;
}
`;

export const C_STDLIB_JSON = `\
// ── ding:json ──────────────────────────────────────────────────────

static const char* __json_skip_ws(const char* p) {
  while (*p == ' ' || *p == '\\t' || *p == '\\n' || *p == '\\r') p++;
  return p;
}

static DingValue __json_parse_value(const char** p);

static ding_string __json_parse_string_raw(const char** p) {
  (*p)++; // skip opening quote
  const char* start = *p;
  // Find end, handling escapes
  size_t len = 0;
  const char* scan = start;
  while (*scan != '"' && *scan != '\\0') {
    if (*scan == '\\\\') { scan++; if (*scan) scan++; }
    else scan++;
    len++;
  }
  // Build result, processing escapes
  ding_string result = (ding_string)ding_alloc(len + 1);
  size_t out = 0;
  const char* s = start;
  while (*s != '"' && *s != '\\0') {
    if (*s == '\\\\') {
      s++;
      switch (*s) {
        case 'n': result[out++] = '\\n'; break;
        case 't': result[out++] = '\\t'; break;
        case 'r': result[out++] = '\\r'; break;
        case '"': result[out++] = '"'; break;
        case '\\\\': result[out++] = '\\\\'; break;
        case '/': result[out++] = '/'; break;
        default: result[out++] = *s; break;
      }
      s++;
    } else {
      result[out++] = *s++;
    }
  }
  result[out] = '\\0';
  if (*s == '"') s++;
  *p = s;
  return result;
}

static DingValue __json_parse_object(const char** p) {
  (*p)++; // skip {
  DingMap* map = ding_map_new();
  *p = __json_skip_ws(*p);
  if (**p == '}') { (*p)++; return (DingValue){.type=DING_MAP, .as_map=map}; }
  while (1) {
    *p = __json_skip_ws(*p);
    ding_string key = __json_parse_string_raw(p);
    *p = __json_skip_ws(*p);
    if (**p == ':') (*p)++;
    *p = __json_skip_ws(*p);
    DingValue val = __json_parse_value(p);
    ding_map_set(map, key, val);
    *p = __json_skip_ws(*p);
    if (**p == ',') { (*p)++; continue; }
    if (**p == '}') { (*p)++; break; }
    break;
  }
  return (DingValue){.type=DING_MAP, .as_map=map};
}

static DingValue __json_parse_array(const char** p) {
  (*p)++; // skip [
  DingArray* arr = ding_array_new();
  *p = __json_skip_ws(*p);
  if (**p == ']') { (*p)++; return (DingValue){.type=DING_ARRAY, .as_array=arr}; }
  while (1) {
    *p = __json_skip_ws(*p);
    DingValue val = __json_parse_value(p);
    ding_array_push(arr, val);
    *p = __json_skip_ws(*p);
    if (**p == ',') { (*p)++; continue; }
    if (**p == ']') { (*p)++; break; }
    break;
  }
  return (DingValue){.type=DING_ARRAY, .as_array=arr};
}

static DingValue __json_parse_number(const char** p) {
  const char* start = *p;
  ding_bool is_float = false;
  if (**p == '-') (*p)++;
  while (**p >= '0' && **p <= '9') (*p)++;
  if (**p == '.') { is_float = true; (*p)++; while (**p >= '0' && **p <= '9') (*p)++; }
  if (**p == 'e' || **p == 'E') { is_float = true; (*p)++; if (**p == '+' || **p == '-') (*p)++; while (**p >= '0' && **p <= '9') (*p)++; }
  if (is_float) {
    return (DingValue){.type=DING_FLOAT, .as_float=strtod(start, NULL)};
  }
  return (DingValue){.type=DING_INT, .as_int=strtoll(start, NULL, 10)};
}

static DingValue __json_parse_value(const char** p) {
  *p = __json_skip_ws(*p);
  switch (**p) {
    case '"': {
      ding_string s = __json_parse_string_raw(p);
      return (DingValue){.type=DING_STRING, .as_string=s};
    }
    case '{': return __json_parse_object(p);
    case '[': return __json_parse_array(p);
    case 't': *p += 4; return (DingValue){.type=DING_BOOL, .as_bool=true};
    case 'f': *p += 5; return (DingValue){.type=DING_BOOL, .as_bool=false};
    case 'n': *p += 4; return DING_VALUE_NULL;
    default: return __json_parse_number(p);
  }
}

DingValue ding_json_parse(ding_string s) {
  const char* p = s;
  return __json_parse_value(&p);
}

// Forward declaration for mutual recursion
static void __json_stringify_value(DingValue val, ding_string* buf, size_t* len, size_t* cap);

static void __json_buf_append(ding_string* buf, size_t* len, size_t* cap, const char* s, size_t slen) {
  while (*len + slen >= *cap) {
    *cap *= 2;
    ding_string newbuf = (ding_string)ding_alloc(*cap);
    memcpy(newbuf, *buf, *len);
    *buf = newbuf;
  }
  memcpy(*buf + *len, s, slen);
  *len += slen;
  (*buf)[*len] = '\\0';
}

static void __json_stringify_string(ding_string s, ding_string* buf, size_t* len, size_t* cap) {
  __json_buf_append(buf, len, cap, "\\"", 1);
  for (size_t i = 0; s[i]; i++) {
    switch (s[i]) {
      case '"': __json_buf_append(buf, len, cap, "\\\\\\"", 2); break;
      case '\\\\': __json_buf_append(buf, len, cap, "\\\\\\\\", 2); break;
      case '\\n': __json_buf_append(buf, len, cap, "\\\\n", 2); break;
      case '\\t': __json_buf_append(buf, len, cap, "\\\\t", 2); break;
      case '\\r': __json_buf_append(buf, len, cap, "\\\\r", 2); break;
      default: __json_buf_append(buf, len, cap, &s[i], 1); break;
    }
  }
  __json_buf_append(buf, len, cap, "\\"", 1);
}

static void __json_stringify_value(DingValue val, ding_string* buf, size_t* len, size_t* cap) {
  switch (val.type) {
    case DING_NULL: __json_buf_append(buf, len, cap, "null", 4); break;
    case DING_BOOL: {
      if (val.as_bool) __json_buf_append(buf, len, cap, "true", 4);
      else __json_buf_append(buf, len, cap, "false", 5);
      break;
    }
    case DING_INT: {
      char num[32];
      int n = snprintf(num, sizeof(num), "%lld", (long long)val.as_int);
      __json_buf_append(buf, len, cap, num, n);
      break;
    }
    case DING_FLOAT: {
      char num[64];
      int n = snprintf(num, sizeof(num), "%g", val.as_float);
      __json_buf_append(buf, len, cap, num, n);
      break;
    }
    case DING_STRING: __json_stringify_string(val.as_string, buf, len, cap); break;
    case DING_ARRAY: {
      __json_buf_append(buf, len, cap, "[", 1);
      for (ding_int i = 0; i < val.as_array->length; i++) {
        if (i > 0) __json_buf_append(buf, len, cap, ",", 1);
        __json_stringify_value(val.as_array->items[i], buf, len, cap);
      }
      __json_buf_append(buf, len, cap, "]", 1);
      break;
    }
    case DING_MAP: {
      __json_buf_append(buf, len, cap, "{", 1);
      ding_bool first = true;
      for (ding_int i = 0; i < val.as_map->capacity; i++) {
        if (val.as_map->buckets[i].occupied) {
          if (!first) __json_buf_append(buf, len, cap, ",", 1);
          first = false;
          __json_stringify_string(val.as_map->buckets[i].key, buf, len, cap);
          __json_buf_append(buf, len, cap, ":", 1);
          __json_stringify_value(val.as_map->buckets[i].value, buf, len, cap);
        }
      }
      __json_buf_append(buf, len, cap, "}", 1);
      break;
    }
    default: __json_buf_append(buf, len, cap, "null", 4); break;
  }
}

ding_string ding_json_stringify(DingValue val) {
  size_t cap = 256;
  size_t len = 0;
  ding_string buf = (ding_string)ding_alloc(cap);
  buf[0] = '\\0';
  __json_stringify_value(val, &buf, &len, &cap);
  return buf;
}
`;

export const C_STDLIB_HTTP = `\
// ── ding:http ──────────────────────────────────────────────────────

#include <curl/curl.h>

typedef struct {
  ding_string data;
  size_t len;
  size_t cap;
} __HttpBuf;

static size_t __http_write_cb(void* contents, size_t size, size_t nmemb, void* userp) {
  size_t total = size * nmemb;
  __HttpBuf* buf = (__HttpBuf*)userp;
  while (buf->len + total >= buf->cap) {
    buf->cap *= 2;
    ding_string newdata = (ding_string)ding_alloc(buf->cap);
    memcpy(newdata, buf->data, buf->len);
    buf->data = newdata;
  }
  memcpy(buf->data + buf->len, contents, total);
  buf->len += total;
  buf->data[buf->len] = '\\0';
  return total;
}

ding_string ding_http_get(ding_string url) {
  CURL* curl = curl_easy_init();
  if (!curl) {
    fprintf(stderr, "Ding: curl init failed\\n");
    exit(1);
  }
  __HttpBuf buf;
  buf.cap = 4096;
  buf.len = 0;
  buf.data = (ding_string)ding_alloc(buf.cap);
  buf.data[0] = '\\0';

  curl_easy_setopt(curl, CURLOPT_URL, url);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, __http_write_cb);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

  CURLcode res = curl_easy_perform(curl);
  if (res != CURLE_OK) {
    fprintf(stderr, "Ding HTTP error: %s\\n", curl_easy_strerror(res));
    curl_easy_cleanup(curl);
    exit(1);
  }
  curl_easy_cleanup(curl);
  return buf.data;
}

ding_string ding_http_post(ding_string url, ding_string body) {
  CURL* curl = curl_easy_init();
  if (!curl) {
    fprintf(stderr, "Ding: curl init failed\\n");
    exit(1);
  }
  __HttpBuf buf;
  buf.cap = 4096;
  buf.len = 0;
  buf.data = (ding_string)ding_alloc(buf.cap);
  buf.data[0] = '\\0';

  struct curl_slist* headers = NULL;
  headers = curl_slist_append(headers, "Content-Type: application/json");

  curl_easy_setopt(curl, CURLOPT_URL, url);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, __http_write_cb);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

  CURLcode res = curl_easy_perform(curl);
  curl_slist_free_all(headers);
  if (res != CURLE_OK) {
    fprintf(stderr, "Ding HTTP error: %s\\n", curl_easy_strerror(res));
    curl_easy_cleanup(curl);
    exit(1);
  }
  curl_easy_cleanup(curl);
  return buf.data;
}
`;

export const C_STDLIB_CONCURRENT = `\
// ── ding:concurrent ────────────────────────────────────────────────

typedef struct DingChannel {
  DingValue value;
  ding_bool has_value;
  ding_bool closed;
  pthread_mutex_t mutex;
  pthread_cond_t  cond_send;
  pthread_cond_t  cond_recv;
} DingChannel;

DingChannel* ding_channel_new() {
  DingChannel* ch = (DingChannel*)ding_alloc(sizeof(DingChannel));
  ch->has_value = false;
  ch->closed = false;
  pthread_mutex_init(&ch->mutex, NULL);
  pthread_cond_init(&ch->cond_send, NULL);
  pthread_cond_init(&ch->cond_recv, NULL);
  return ch;
}

void ding_channel_send(DingChannel* ch, DingValue val) {
  pthread_mutex_lock(&ch->mutex);
  while (ch->has_value && !ch->closed) {
    pthread_cond_wait(&ch->cond_send, &ch->mutex);
  }
  ch->value = val;
  ch->has_value = true;
  pthread_cond_signal(&ch->cond_recv);
  pthread_mutex_unlock(&ch->mutex);
}

DingValue ding_channel_receive(DingChannel* ch) {
  pthread_mutex_lock(&ch->mutex);
  while (!ch->has_value && !ch->closed) {
    pthread_cond_wait(&ch->cond_recv, &ch->mutex);
  }
  DingValue val = ch->value;
  ch->has_value = false;
  pthread_cond_signal(&ch->cond_send);
  pthread_mutex_unlock(&ch->mutex);
  return val;
}
`;

export const C_CONCURRENT_FUNCTION_MAP: Record<string, string> = {
  Channel: "ding_channel_new",
};

export const C_HTTP_FUNCTION_MAP: Record<string, string> = {
  get: "ding_http_get",
  post: "ding_http_post",
};

export const C_IO_FUNCTION_MAP: Record<string, string> = {
  readFile: "ding_io_readFile",
  writeFile: "ding_io_writeFile",
  appendFile: "ding_io_appendFile",
  readLine: "ding_io_readLine",
  args: "ding_io_args",
  exists: "ding_io_exists",
};

export const C_JSON_FUNCTION_MAP: Record<string, string> = {
  parse: "ding_json_parse",
  stringify: "ding_json_stringify",
};

export const C_STD_FUNCTION_MAP: Record<string, string> = {
  log: "ding_log",
  warn: "ding_warn",
  error: "ding_error",
  assert: "ding_assert",
};

export const C_MATH_FUNCTION_MAP: Record<string, string> = {
  floor: "ding_math_floor",
  ceil: "ding_math_ceil",
  round: "ding_math_round",
  abs: "ding_math_abs",
  min: "ding_math_min",
  max: "ding_math_max",
  pow: "ding_math_pow",
  sqrt: "ding_math_sqrt",
};
