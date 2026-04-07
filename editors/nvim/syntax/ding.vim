" Vim syntax file for the Ding programming language
" Language:   Ding
" Maintainer: Johnny Simmons
" License:    MIT

if exists("b:current_syntax")
  finish
endif

" Keywords
syn keyword dingKeyword       const let for while if else return import from in
syn keyword dingKeyword       break continue struct self try catch throw finally
syn keyword dingKeyword       enum match spawn as type

" Constants
syn keyword dingConstant      true false null

" Type keywords (used in annotations)
syn keyword dingType          number int int8 int16 int32 int64
syn keyword dingType          uint8 uint16 uint32 uint64 byte
syn keyword dingType          float float32 float64 double
syn keyword dingType          string cstring bool void

" Struct/enum names (capitalized identifiers)
syn match   dingTypeName      "\<[A-Z][A-Za-z0-9_]*\>"

" Function calls
syn match   dingFunction      "\<[a-zA-Z_][a-zA-Z0-9_]*\>\ze\s*("

" Numbers
syn match   dingNumber        "\<\d\+\(\.\d\+\)\?\>"

" Operators
syn match   dingOperator      "=>"
syn match   dingOperator      "\*\*"
syn match   dingOperator      "|>"
syn match   dingOperator      "\.\.\."
syn match   dingOperator      "\.\."
syn match   dingOperator      "??"
syn match   dingOperator      "?\."
syn match   dingOperator      "+="
syn match   dingOperator      "-="
syn match   dingOperator      "\*="
syn match   dingOperator      "/="
syn match   dingOperator      "%="
syn match   dingOperator      "=="
syn match   dingOperator      "!="
syn match   dingOperator      "<="
syn match   dingOperator      ">="
syn match   dingOperator      "<<"
syn match   dingOperator      ">>"
syn match   dingOperator      "&&"
syn match   dingOperator      "||"
syn match   dingOperator      "[=<>+\-*/%!&|^~#]"

" Strings
syn region  dingString        start=+"+ skip=+\\\\\|\\"+ end=+"+ contains=dingEscape
syn region  dingString        start=+'+ skip=+\\\\\|\\'+ end=+'+ contains=dingEscape
syn region  dingTemplate      start=+`+ skip=+\\\\\|\\`+ end=+`+ contains=dingInterp,dingEscape
syn match   dingEscape        "\\." contained
syn region  dingInterp        matchgroup=dingInterpDelim start="\${" end="}" contained contains=TOP

" Comments
syn match   dingComment       "//.*$"
syn region  dingComment       start="/\*" end="\*/"

" Highlighting links
hi def link dingKeyword       Keyword
hi def link dingConstant      Constant
hi def link dingType          Type
hi def link dingTypeName      Type
hi def link dingFunction      Function
hi def link dingNumber        Number
hi def link dingOperator      Operator
hi def link dingString        String
hi def link dingTemplate      String
hi def link dingEscape        SpecialChar
hi def link dingInterpDelim   Special
hi def link dingComment       Comment

let b:current_syntax = "ding"
