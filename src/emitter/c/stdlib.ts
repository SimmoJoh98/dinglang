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
