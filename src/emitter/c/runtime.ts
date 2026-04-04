export const C_RUNTIME = `\
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include <setjmp.h>

// ── Ding types ──────────────────────────────────────────────────────

// Default types (lazy path)
typedef int64_t  ding_int;
typedef double   ding_float;
typedef bool     ding_bool;
typedef char*    ding_string;
typedef const char* ding_cstring;
typedef void*    ding_any;

// Sized integer types (precise path)
typedef int8_t   ding_int8;
typedef int16_t  ding_int16;
typedef int32_t  ding_int32;
typedef int64_t  ding_int64;
typedef uint8_t  ding_uint8;
typedef uint16_t ding_uint16;
typedef uint32_t ding_uint32;
typedef uint64_t ding_uint64;
typedef uint8_t  ding_byte;

// Sized float types
typedef float    ding_float32;
typedef double   ding_float64;

// ── Tagged union for dynamic values ─────────────────────────────────

typedef enum {
  DING_NULL,
  DING_INT,
  DING_FLOAT,
  DING_BOOL,
  DING_STRING,
  DING_ARRAY,
  DING_OBJECT,
} DingType;

typedef struct DingValue DingValue;
typedef struct DingArray DingArray;

struct DingArray {
  DingValue* items;
  ding_int   length;
  ding_int   capacity;
};

struct DingValue {
  DingType type;
  union {
    ding_int    as_int;
    ding_float  as_float;
    ding_bool   as_bool;
    ding_string as_string;
    DingArray*  as_array;
  };
};

static const DingValue DING_VALUE_NULL = { .type = DING_NULL };

// ── Error handling (setjmp/longjmp) ─────────────────────────────────

static jmp_buf __ding_jmp;
static DingValue __ding_err;
`;
