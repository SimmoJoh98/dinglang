import type { Expression, TypeAnnotation } from "../../ast/nodes.js";

export type CType =
  // Default types (lazy path)
  | "ding_int"
  | "ding_float"
  | "ding_bool"
  | "ding_string"
  | "ding_cstring"
  // Sized integers (precise path)
  | "ding_int8"
  | "ding_int16"
  | "ding_int32"
  | "ding_int64"
  | "ding_uint8"
  | "ding_uint16"
  | "ding_uint32"
  | "ding_uint64"
  | "ding_byte"
  // Sized floats
  | "ding_float32"
  | "ding_float64"
  // Composite / special
  | "DingValue"
  | "DingArray*"
  | "DingMap*"
  | "DingChannel*"
  | "void";

/** Map from Ding annotation name → C type string */
const ANNOTATION_MAP: Record<string, CType> = {
  // Lazy path
  number:  "ding_int",
  int:     "ding_int",
  float:   "ding_float",
  double:  "ding_float64",
  string:  "ding_string",
  cstring: "ding_cstring",
  bool:    "ding_bool",
  void:    "void",

  // Sized integers
  int8:    "ding_int8",
  int16:   "ding_int16",
  int32:   "ding_int32",
  int64:   "ding_int64",
  uint8:   "ding_uint8",
  uint16:  "ding_uint16",
  uint32:  "ding_uint32",
  uint64:  "ding_uint64",
  byte:    "ding_byte",

  // Sized floats
  float32: "ding_float32",
  float64: "ding_float64",
};

export function mapAnnotationToCType(annotation: TypeAnnotation | undefined): CType {
  if (!annotation) return "DingValue";
  const mapped = ANNOTATION_MAP[annotation.name];
  if (mapped) return mapped;
  if (annotation.name.endsWith("[]")) return "DingArray*";
  return "DingValue";
}

export function inferCType(expr: Expression): CType {
  switch (expr.type) {
    case "NumberLiteral":
      return Number.isInteger(expr.value) ? "ding_int" : "ding_float";
    case "StringLiteral":
      return "ding_string";
    case "BooleanLiteral":
      return "ding_bool";
    case "NullLiteral":
      return "DingValue";
    case "ArrayLiteral":
      return "DingArray*";
    case "TemplateLiteral":
      return "ding_string";
    case "ArrowFunction":
      return "DingValue";
    case "BinaryExpression": {
      const leftType = inferCType(expr.left);
      const rightType = inferCType(expr.right);
      if (expr.operator === "**") return "ding_float";
      if (expr.operator === "+" && (leftType === "ding_string" || rightType === "ding_string")) {
        return "ding_string";
      }
      if (expr.operator === "*" && (isStringType(leftType) || isStringType(rightType))) {
        return "ding_string";
      }
      if (isFloatType(leftType) || isFloatType(rightType)) {
        return "ding_float";
      }
      if (isIntegerType(leftType) && isIntegerType(rightType)) {
        return "ding_int";
      }
      if (expr.operator === "==" || expr.operator === "!=" ||
          expr.operator === "<" || expr.operator === ">" ||
          expr.operator === "<=" || expr.operator === ">=") {
        return "ding_bool";
      }
      return "DingValue";
    }
    case "StructInstantiation":
      return "DingValue";
    case "MapLiteral":
      return "DingMap*";
    case "LengthExpression":
      return "ding_int";
    default:
      return "DingValue";
  }
}

export function cTypeToString(cType: CType): string {
  return cType;
}

/** Any integer type (signed or unsigned, any width) */
export function isIntegerType(cType: CType): boolean {
  return cType === "ding_int" || cType === "ding_int8" || cType === "ding_int16" ||
    cType === "ding_int32" || cType === "ding_int64" || cType === "ding_uint8" ||
    cType === "ding_uint16" || cType === "ding_uint32" || cType === "ding_uint64" ||
    cType === "ding_byte";
}

/** Any float type */
export function isFloatType(cType: CType): boolean {
  return cType === "ding_float" || cType === "ding_float32" || cType === "ding_float64";
}

export function isNumericType(cType: CType): boolean {
  return isIntegerType(cType) || isFloatType(cType);
}

export function isStringType(cType: CType): boolean {
  return cType === "ding_string" || cType === "ding_cstring";
}

export function wrapAsDingValue(expr: string, cType: CType): string {
  if (isIntegerType(cType)) {
    // ding_int is the native union member — no cast needed
    // Narrower/unsigned types need widening cast
    const val = cType === "ding_int" ? expr : `(ding_int)(${expr})`;
    return `(DingValue){.type=DING_INT, .as_int=${val}}`;
  }
  if (isFloatType(cType)) {
    const val = (cType === "ding_float" || cType === "ding_float64") ? expr : `(ding_float)(${expr})`;
    return `(DingValue){.type=DING_FLOAT, .as_float=${val}}`;
  }
  switch (cType) {
    case "ding_bool":
      return `(DingValue){.type=DING_BOOL, .as_bool=${expr}}`;
    case "ding_string":
      return `(DingValue){.type=DING_STRING, .as_string=${expr}}`;
    case "ding_cstring":
      return `(DingValue){.type=DING_STRING, .as_string=(ding_string)(${expr})}`;
    case "DingArray*":
      return `(DingValue){.type=DING_ARRAY, .as_array=${expr}}`;
    case "DingMap*":
      return `(DingValue){.type=DING_MAP, .as_map=${expr}}`;
    case "DingValue":
      return expr;
    default:
      return expr;
  }
}

export function unwrapFromDingValue(expr: string, targetType: CType): string {
  if (isIntegerType(targetType)) {
    return `(${targetType})(${expr}).as_int`;
  }
  if (isFloatType(targetType)) {
    return `(${targetType})(${expr}).as_float`;
  }
  switch (targetType) {
    case "ding_bool":
      return `${expr}.as_bool`;
    case "ding_string":
      return `${expr}.as_string`;
    case "ding_cstring":
      return `(ding_cstring)(${expr}).as_string`;
    case "DingArray*":
      return `${expr}.as_array`;
    case "DingMap*":
      return `${expr}.as_map`;
    default:
      return expr;
  }
}
