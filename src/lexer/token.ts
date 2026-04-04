export enum TokenType {
  // Literals
  Number = "Number",
  String = "String",
  Identifier = "Identifier",

  // Keywords
  Const = "const",
  Let = "let",
  Import = "import",
  From = "from",
  If = "if",
  Else = "else",
  Return = "return",
  Null = "null",
  True = "true",
  False = "false",
  For = "for",
  While = "while",
  In = "in",
  Break = "break",
  Continue = "continue",
  Struct = "struct",
  Self = "self",
  Try = "try",
  Catch = "catch",
  Throw = "throw",
  Finally = "finally",
  As = "as",

  // Operators
  Equals = "=",
  DoubleEquals = "==",
  NotEquals = "!=",
  Arrow = "=>",
  Plus = "+",
  Minus = "-",
  Star = "*",
  Slash = "/",
  LessThan = "<",
  LessThanEquals = "<=",
  GreaterThan = ">",
  GreaterThanEquals = ">=",
  DotDot = "..",
  Dot = ".",
  Hash = "#",
  QuestionDot = "?.",
  QuestionQuestion = "??",
  QuestionMark = "?",
  Bang = "!",

  // Delimiters
  LeftParen = "(",
  RightParen = ")",
  LeftBrace = "{",
  RightBrace = "}",
  LeftBracket = "[",
  RightBracket = "]",
  Comma = ",",
  Colon = ":",
  Semicolon = ";",
  Backtick = "`",

  // Special
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}
