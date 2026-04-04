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
  GreaterThan = ">",

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
