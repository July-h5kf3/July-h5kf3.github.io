---
title: "[从零开始的编译原理][实验] Exp Chapter 1：从 SysY 到 Koopa IR"
date: 2026-09-29T20:23:03+08:00
slug: compiler-exp1-sysy-to-koopa-ir
series:
    - 技术分享
categories:
    - 编译原理
column:
    - 编译原理
tags:
    - 编译原理
    - 编译器实验
    - Flex
    - Bison
    - AST
    - Koopa IR
seriesOrder: 4
math: true
comments: false
---

接下来，我们正式开始实现自己的编译器。

本阶段的目标是先完成一个最小可用版本：让编译器能够处理一个简单的 `main` 函数，并生成对应的 Koopa IR。

一个完整编译器的典型流程大致如下：

```text
词法分析
-> 语法分析
-> AST
-> 语义分析
-> 带有类型 / 符号信息的 AST
-> IR 生成
-> 优化
-> 指令选择
-> 寄存器分配
-> 指令调度
```

其中，词法分析、语法分析和 AST 构建属于编译器前端；

IR 生成通常位于前端与中端的衔接位置，而后续的优化、指令选择、寄存器分配和指令调度则会逐步进入编译器中端和后端。

根据指导书的安排，本次实验暂时不会实现完整的编译器流程，而是先完成从源代码到 Koopa IR 的这一部分，也就是：

```text
源代码
-> 词法分析
-> 语法分析
-> AST
-> IR 生成
```

通过这一阶段，我们可以先打通一个最基本的编译流程，再在后续实验中逐步加入更完整的语义分析、优化以及代码生成等功能。

## 词法分析 & 语法分析

首先来看编译器前端最基础的两个阶段：**词法分析（Lexical Analysis）和语法分析（Syntax Analysis）**。

在本实验中，我们并不打算从零手写词法分析器和语法分析器，而是分别使用 **Flex** 和 **Bison** 来自动生成它们。我们只需要根据 SysY 的词法和语法规范，描述各种 Token 的形式以及程序的文法结构，之后 Flex 和 Bison 就可以据此生成对应的分析器。

### SysY 的部分词法 / 语法规范

在本章中，我们暂时只实现一个能够处理 `main` 函数和 `return` 语句的简单编译器。也就是说，目前我们的编译器只需要能够处理类似下面这样的 SysY 程序：

```c
int main() {
    // 注释也应该被忽略
    return 0;
}
```

最终，我们希望将它编译成对应的 Koopa IR：

```text
fun @main(): i32 {
%entry:
    ret 0
}
```

在真正开始编写 Flex 和 Bison 代码之前，我们先来看一下这一阶段需要处理的 SysY 词法和语法规范。

词法规范主要描述源代码中存在哪些 Token，以及每种 Token 长什么样。例如：

```c
int main() {
    return 0;
}
```

经过词法分析以后，大致可以得到：

```text
INT IDENT '(' ')' '{' RETURN INT_CONST ';' '}'
```

其中，`main` 和 `0` 除了 Token 类型之外，还需要携带它们自身的值。

SysY 中标识符 `IDENT` 的规范如下：

```text
identifier ::= identifier-nondigit
             | identifier identifier-nondigit
             | identifier digit;
```

其中 `identifier-nondigit` 为下划线 `_`、小写英文字母或大写英文字母，`digit` 为数字 `0` 到 `9`。

换句话说，标识符的首字符只能是字母或下划线，后续字符还可以包含数字，因此可以使用正则表达式：

```text
[a-zA-Z_][a-zA-Z0-9_]*
```

来描述。

SysY 中的整型常量记作 `INT_CONST`，可以采用十进制、八进制或十六进制表示：

```text
integer-const      ::= decimal-const
                     | octal-const
                     | hexadecimal-const;

decimal-const      ::= nonzero-digit
                     | decimal-const digit;

octal-const        ::= "0"
                     | octal-const octal-digit;

hexadecimal-const  ::= hexadecimal-prefix hexadecimal-digit
                     | hexadecimal-const hexadecimal-digit;

hexadecimal-prefix ::= "0x" | "0X";
```

其中，`nonzero-digit` 为数字 `1` 到 `9`，`octal-digit` 为数字 `0` 到 `7`，`hexadecimal-digit` 为数字 `0` 到 `9` 或大小写字母 `a-f`。

例如：

```text
123      十进制
077      八进制
0xFF     十六进制
```

SysY 中的注释规则与 C 语言基本一致：

- 单行注释以 `//` 开始，一直到换行符结束；
- 多行注释以 `/*` 开始，直到第一次出现 `*/` 时结束。

注释在后续编译阶段中没有意义，因此词法分析器识别出注释之后，可以直接将它们丢弃。

目前我们只需要支持如下语法：

```text
CompUnit ::= FuncDef;

FuncDef  ::= FuncType IDENT "(" ")" Block;
FuncType ::= "int";

Block    ::= "{" Stmt "}";
Stmt     ::= "return" Number ";";
Number   ::= INT_CONST;
```

其中，开始符号为 `CompUnit`。

### EBNF 介绍

EBNF，即 **Extended Backus–Naur Form（扩展巴科斯范式）**，是一种用于描述编程语言语法的形式化方法。

基于 SysY 的 EBNF，我们可以从指定的开始符号出发，通过不断应用产生式规则，推导出所有符合该语法的程序。

EBNF 由若干条类似下面的规则组成：

```text
A ::= B;
```

它表示，当我们遇到 `A` 时，可以按照这条规则将 `A` 替换成 `B`，这个过程称为一次**推导（Derivation）**。

例如：

```text
CompUnit ::= FuncDef;
```

表示：

```text
CompUnit
```

可以被替换成：

```text
FuncDef
```

像 `CompUnit`、`FuncDef`、`FuncType`、`Block`、`Stmt`、`Number` 这样还能继续按照某条产生式展开的符号，被称为**非终结符（Non-terminal）**。

我们从开始符号 `CompUnit` 出发：

```text
CompUnit
```

根据：

```text
CompUnit ::= FuncDef;
```

得到：

```text
FuncDef
```

继续根据：

```text
FuncDef ::= FuncType IDENT "(" ")" Block;
```

得到：

```text
FuncType IDENT "(" ")" Block
```

再利用：

```text
FuncType ::= "int";
```

可以得到：

```text
"int" IDENT "(" ")" Block
```

继续展开 `Block`、`Stmt` 和 `Number`，最终得到：

```text
"int" IDENT "(" ")" "{" "return" INT_CONST ";" "}"
```

此时已经没有符号可以继续按照产生式展开。像 `"int"`、`IDENT`、`"("`、`INT_CONST` 这样的符号，就称为**终结符（Terminal）**。

这些终结符基本上就对应词法分析器产生的 Token。

因此可以粗略地理解为：

```text
源代码
   │
   ▼
词法分析
   │
   ▼
Token / 终结符
   │
   ▼
语法分析
   │
   ▼
按照文法规则组合成程序结构
```

### Flex 教程

在 C++ 中，我们使用 **Flex** 生成词法分析器。

Flex 主要负责描述 EBNF 中的终结符，也就是描述每种 Token 的形式，并在识别出 Token 后返回对应的类型和语义值。Token 的形式通常可以使用正则表达式来描述。

首先在 `src` 目录下创建：

```text
sysy.l
```

Flex 文件大致被两个 `%%` 分成三个区域：

```text
定义区
%%
规则区
%%
用户代码区
```

定义区位于第一个 `%%` 之前，主要用于设置 Flex 选项、插入 C++ 代码，以及定义可以复用的正则表达式：

```text
%option noyywrap
%option nounput
%option noinput

%{

#include <cstdlib>
#include <string>

// Flex 需要使用 Bison 中定义的 Token 和 yylval
#include "sysy.tab.hpp"

using namespace std;

%}

/* 空白符和注释 */
WhiteSpace       [ \t\n\r]*
LineComment      "//".*
MultiLineComment "/*"([^*]|\*+[^*/])*\*+"/"

/* 标识符 */
Identifier       [a-zA-Z_][a-zA-Z0-9_]*

/* 整数字面量 */
Decimal          [1-9][0-9]*
Octal            0[0-7]*
Hexadecimal      0[xX][0-9a-fA-F]+
```

最前面的：

```text
%option noyywrap
%option nounput
%option noinput
```

是 Flex 的一些配置选项。默认情况下，Flex 会生成一些我们当前用不到的接口，因此这里直接将它们关闭。

被：

```text
%{
...
%}
```

包围的代码会被原样插入 Flex 生成的源文件。

这里需要包含：

```cpp
#include "sysy.tab.hpp"
```

因为稍后的规则中需要使用：

```text
INT
RETURN
IDENT
INT_CONST
```

等 Token，而这些 Token 的编号，以及 `yylval` 的类型，都是由 Bison 生成的头文件定义的。

后面的：

```text
Identifier [a-zA-Z_][a-zA-Z0-9_]*
```

相当于给一段正则表达式起一个名字。之后在规则区中就可以直接写：

```text
{Identifier}
```

而不需要反复写完整的正则表达式。

多行注释稍微特殊一些。在某些支持非贪婪匹配的正则表达式引擎中，可以写成类似：

```text
/\*.*?\*/
```

但 Flex 并不直接支持这种写法，而且 `.` 默认不能匹配换行符，因此可以写成：

```text
"/*"([^*]|\*+[^*/])*\*+"/"
```

其中：

```text
[^*]
```

表示任意不是 `*` 的字符，因此也可以匹配换行符；而：

```text
\*+[^*/]
```

则用于处理注释内部出现的一个或多个 `*`，同时避免过早将它们识别为结束标记 `*/`。

规则区位于两个 `%%` 之间。每一条规则都由“模式 + 动作”组成，当 Flex 匹配到某个模式时，就执行后面的 C++ 动作：

```text
{WhiteSpace}       { /* 忽略 */ }
{LineComment}      { /* 忽略 */ }
{MultiLineComment} { /* 忽略 */ }

"int"              { return INT; }
"return"           { return RETURN; }

{Identifier} {
    yylval.str_val = new string(yytext);
    return IDENT;
}

{Decimal} {
    yylval.int_val = strtol(yytext, nullptr, 0);
    return INT_CONST;
}

{Octal} {
    yylval.int_val = strtol(yytext, nullptr, 0);
    return INT_CONST;
}

{Hexadecimal} {
    yylval.int_val = strtol(yytext, nullptr, 0);
    return INT_CONST;
}

. {
    return yytext[0];
}
```

Flex 在存在多条可以匹配的规则时，会遵循两个原则：

1. 优先选择能够匹配最长字符串的规则；
2. 如果匹配长度相同，则选择写在前面的规则。

例如 `int` 既可以匹配：

```text
"int"
```

也可以匹配：

```text
{Identifier}
```

两者匹配长度都是 3，因此 Flex 会选择写在前面的 `"int"` 规则。这也是为什么关键字通常要写在标识符规则之前。

在动作中，我们还会经常使用几个 Flex 提供的变量：

- `yytext`：当前刚刚匹配到的源代码文本，是一个 C 风格字符串；
- `yyleng`：当前 `yytext` 的长度；
- `yylval`：传递给语法分析器的语义值。

例如输入：

```text
main
```

被 `{Identifier}` 匹配后：

```text
yytext
```

的内容就是 `"main"`。

而：

```text
yylval.str_val = new string(yytext);
```

则将真正的标识符名称保存下来并传递给 Bison。

对于整数：

```text
yylval.int_val = strtol(yytext, nullptr, 0);
```

则把文本形式的整数转换为真正的数值。

这里的：

```text
str_val
int_val
```

会在稍后的 Bison `%union` 中定义。

最后：

```text
. { return yytext[0]; }
```

表示，如果前面的所有规则都没有匹配，就直接把当前单个字符作为 Token 返回。

因此：

```text
(
)
{
}
;
```

这些字符不需要分别定义 `LPAREN`、`RPAREN` 等 Token，而是可以直接返回字符本身。

最后一个 `%%` 之后是用户代码区。虽然目前我们暂时没有使用这一部分，但以后可以在这里定义一些普通的 C++ 辅助函数。

### Bison 教程

完成词法分析器之后，接下来使用 **Bison** 生成语法分析器。

首先在 `src` 目录中创建：

```text
sysy.y
```

与 Flex 类似，Bison 文件同样使用两个 `%%` 分成三个部分：

```text
声明区
%%
文法区
%%
用户代码区
```

声明区主要负责插入 C++ 代码、声明 Token、定义语义值类型、定义非终结符的语义类型，以及给 parser 增加额外参数：

```text
%code requires {
  #include <memory>
  #include <string>
}

%{

#include <iostream>
#include <memory>
#include <string>

int yylex();
void yyerror(std::unique_ptr<std::string> &ast, const char *s);

using namespace std;

%}

%parse-param { std::unique_ptr<std::string> &ast }

%union {
  std::string *str_val;
  int int_val;
}

%token INT RETURN
%token <str_val> IDENT
%token <int_val> INT_CONST

%type <str_val> FuncDef FuncType Block Stmt Number
```

其中：

```text
%code requires {
    ...
}
```

中的代码会被放入 Bison 生成的头文件 `sysy.tab.hpp` 中。

而：

```text
%{
...
%}
```

中的内容主要会进入 Bison 生成的解析器源文件。

这里：

```text
int yylex();
```

用于声明 Flex 生成的词法分析器函数。Bison 在需要读取下一个 Token 时，就会调用 `yylex()`。

而：

```cpp
void yyerror(...);
```

用于声明语法分析发生错误时调用的错误处理函数。

```text
%parse-param { std::unique_ptr<std::string> &ast }
```

表示给生成的 `yyparse()` 增加一个额外参数。于是我们就可以：

```cpp
unique_ptr<string> ast;
yyparse(ast);
```

解析完成之后，再把最终结果通过 `ast` 交回调用方。

这里暂时使用一个字符串保存语法分析的结果，在下一节中再把它真正替换成 AST。

在语法分析过程中，不同 Token 和非终结符可能携带不同类型的值。例如：

```text
IDENT
```

需要携带一个：

```cpp
std::string *
```

而：

```text
INT_CONST
```

需要携带一个：

```text
int
```

因此 Bison 使用：

```text
%union {
    std::string *str_val;
    int int_val;
}
```

定义语义值可能采用的类型。

于是 Flex 中的：

```text
yylval.str_val
```

和：

```text
yylval.int_val
```

就是这里定义的两个字段。

这里暂时使用 `std::string *`，而不是直接使用 `std::string`，是因为传统 C 风格 `union` 对带有非平凡构造函数和析构函数的 C++ 类型处理起来比较麻烦。

接下来：

```text
%token INT RETURN
```

声明 `INT` 和 `RETURN` 两种 Token。

而：

```text
%token <str_val> IDENT
%token <int_val> INT_CONST
```

则表示 `IDENT` 携带 `str_val` 类型的语义值，`INT_CONST` 携带 `int_val` 类型的语义值。

这些 Token 名字必须与 Flex 中：

```text
return INT;
return RETURN;
return IDENT;
return INT_CONST;
```

使用的名字一致。

最后：

```text
%type <str_val> FuncDef FuncType Block Stmt Number
```

表示这些非终结符的语义值类型都是：

```cpp
std::string *
```

也就是说，当这些非终结符完成规约后，会产生一个字符串结果并继续向上传递。

Bison 的文法规则基本形式如下：

```text
非终结符
  : 产生式 {
      动作
    }
  ;
```

如果一个非终结符存在多个产生式，则可以使用 `|` 分隔。

目前我们需要解析的程序只有：

```c
int main() {
    return 0;
}
```

整个程序只包含一个函数定义，因此：

```text
CompUnit ::= FuncDef;
```

在 Bison 中可以写成：

```text
CompUnit
  : FuncDef {
      ast = unique_ptr<string>($1);
    }
  ;
```

这里：

```text
$1
```

表示产生式右侧第一个符号的语义值。

因为右侧只有一个 `FuncDef`，所以 `$1` 就是 `FuncDef` 的返回值。

当整个输入最终被成功规约为开始符号 `CompUnit` 时，语法分析就完成了，因此我们把 `$1` 保存到 `ast` 中作为最终结果。

接下来是：

```text
FuncDef ::= FuncType IDENT "(" ")" Block;
```

对应：

```text
FuncDef
  : FuncType IDENT '(' ')' Block {
      auto type = unique_ptr<string>($1);
      auto ident = unique_ptr<string>($2);
      auto block = unique_ptr<string>($5);

      $$ = new string(
          *type + " " + *ident + "()" + *block
      );
    }
  ;
```

这里需要认识 Bison 中两个非常重要的记号。

`$1`、`$2` 等表示产生式右侧各个符号的语义值，例如：

```text
FuncType IDENT '(' ')' Block
   $1     $2   $3  $4   $5
```

而：

```text
$$
```

则表示当前产生式左侧非终结符的语义值。

因此：

```text
$$ = new string(...);
```

表示这几个符号被规约成 `FuncDef` 后，`FuncDef` 自身的语义值就是这个新生成的字符串。

这里：

```text
auto type = unique_ptr<string>($1);
auto ident = unique_ptr<string>($2);
auto block = unique_ptr<string>($5);
```

则是使用 `unique_ptr` 接管之前通过 `new string(...)` 创建的字符串。

例如 `$1` 原本只是一个裸指针：

```text
string *
```

将它交给：

```cpp
unique_ptr<string>
```

后，这块内存就由智能指针负责管理。当当前语义动作执行结束、局部变量离开作用域时，对应的字符串也会被自动释放，因此我们不需要手动调用 `delete`。

剩下的语法可以按照同样的方法实现：

```text
FuncType ::= "int";
Block ::= "{" Stmt "}";
Stmt ::= "return" Number ";";
Number ::= INT_CONST;
```

对应：

```text
FuncType
  : INT {
      $$ = new string("int");
    }
  ;

Block
  : '{' Stmt '}' {
      auto stmt = unique_ptr<string>($2);
      $$ = new string("{" + *stmt + "}");
    }
  ;

Stmt
  : RETURN Number ';' {
      auto number = unique_ptr<string>($2);
      $$ = new string("return " + *number + ";");
    }
  ;

Number
  : INT_CONST {
      $$ = new string(to_string($1));
    }
  ;
```

随着 Bison 不断进行规约，这些字符串会逐层向上传递：

```text
INT_CONST
    │
    ▼
 Number
    │
    ▼
  Stmt
    │
    ▼
  Block
    │
    ▼
 FuncDef
    │
    ▼
CompUnit
```

最终可以得到类似：

```text
int main(){return 0;}
```

这样的结果。

需要注意的是，**这里还没有真正构造 AST**。我们只是暂时使用字符串来模拟语法分析结果，从而熟悉 Bison 的语义动作以及 `$1`、`$$` 等机制。真正的 AST 会在下一节实现。

第二个 `%%` 之后是用户代码区。目前我们只需要定义错误处理函数：

```cpp
void yyerror(unique_ptr<string> &ast, const char *s) {
    cerr << "error: " << s << endl;
}
```

当 Bison 在语法分析过程中发现输入不符合文法时，就会调用 `yyerror()` 输出错误信息。

### 生成词法 / 语法分析器

完成 `sysy.l` 和 `sysy.y` 后，Flex 和 Bison 就可以根据我们的规则生成真正的词法分析器和语法分析器。

接下来修改：

```text
src/main.cpp
```

内容如下：

```cpp
#include <cassert>
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>

using namespace std;

extern FILE *yyin;
extern int yyparse(unique_ptr<string> &ast);

int main(int argc, const char *argv[]) {
    assert(argc == 5);

    auto mode = argv[1];
    auto input = argv[2];
    auto output = argv[4];

    yyin = fopen(input, "r");
    assert(yyin);

    unique_ptr<string> ast;

    auto ret = yyparse(ast);
    assert(!ret);

    cout << *ast << endl;

    return 0;
}
```

其中：

```cpp
extern FILE *yyin;
```

表示 Flex 应该从哪个文件读取输入。

因此：

```cpp
yyin = fopen(input, "r");
```

就是将需要编译的 SysY 源文件交给词法分析器。

而：

```cpp
yyparse(ast);
```

会启动 Bison 生成的语法分析器。当语法分析器需要新的 Token 时，就会调用 Flex 生成的：

```text
yylex()
```

因此整个过程可以表示为：

```text
SysY 源文件
     │
     ▼
   Flex
     │
     │ yylex()
     ▼
   Token
     │
     ▼
   Bison
     │
     │ 规约
     ▼
解析结果
```

接下来进入开发环境：

```bash
docker run -it --rm \
  -v /path/to/compiler:/root/compiler \
  maxxing/compiler-dev bash
```

编译项目：

```bash
cmake --build build
```

然后运行：

```bash
./build/compiler --koopa debug/lab1.sy -o debug/lab1.koopa
```

此时可以看到输出：

```text
int main(){return 0;}
```

这说明我们的词法分析器和语法分析器已经能够正确识别：

```c
int main() {
    return 0;
}
```

到这里，我们已经完成了最基本的：

```text
源代码
   │
   ▼
词法分析
   │
   ▼
Token Stream
   │
   ▼
语法分析
   │
   ▼
程序结构
```

不过，目前所谓的“程序结构”仍然只是通过字符串拼接得到的临时结果。

在下一节中，我们会正式定义 **AST（Abstract Syntax Tree）**，并让 Bison 在语法分析过程中直接构造真正的 AST。

## 解析 main 函数：构建 AST

在第一节中，我们借助 Flex 和 Bison 实现了一个能够解析简单 `main` 函数的编译器前端。

不过，此时语法分析器只是将解析结果重新拼接成一个字符串。虽然这足以帮助我们理解 Bison 的基本工作方式，但字符串并不适合作为后续编译阶段处理程序的数据结构。

因此，在本节中，我们将正式设计 AST，并让 Bison 在语法分析过程中直接构造 AST。

### 设计 AST

AST，即 **Abstract Syntax Tree（抽象语法树）**，用于保存源程序中对后续编译阶段真正有意义的结构。

后续的语义分析、中间代码生成以及优化，都需要在 AST 上进行，因此 AST 的设计主要需要考虑两点：

1. 能够表达程序中必要的语法和语义结构；
2. 尽可能方便后续编译阶段处理。

在当前实验中，我们处理的语法如下：

```text
CompUnit ::= FuncDef;

FuncDef  ::= FuncType IDENT "(" ")" Block;
FuncType ::= "int";

Block    ::= "{" Stmt "}";
Stmt     ::= "return" Number ";";
Number   ::= INT_CONST;
```

从文法结构来看，可以得到大致如下的层次关系：

```text
CompUnit
└── FuncDef
    ├── FuncType
    ├── IDENT
    └── Block
        └── Stmt
            └── Number
```

因此，可以先按照这个结构设计 AST。

首先创建：

```text
src/ast.hpp
```

并定义所有 AST 节点的公共基类：

```cpp
#pragma once

#include <memory>
#include <string>

class BaseAST {
public:
    virtual ~BaseAST() = default;
};
```

这里：

```cpp
#pragma once
```

用于避免同一个头文件在一个编译单元中被重复包含，从而防止类或函数被重复定义。

而：

```cpp
virtual ~BaseAST() = default;
```

则定义了一个虚析构函数。

之后，我们会经常使用：

```cpp
std::unique_ptr<BaseAST>
```

来保存不同类型的 AST 节点。例如：

```cpp
std::unique_ptr<BaseAST> ast =
    std::make_unique<FuncDefAST>();
```

虽然指针类型是 `BaseAST`，但实际对象可能是 `FuncDefAST`、`BlockAST` 等派生类。因此，基类的析构函数必须是虚函数，这样通过 `BaseAST` 指针销毁对象时，才能正确调用实际派生类的析构函数。

接下来可以根据文法定义具体的 AST 节点。

例如：

```text
CompUnit ::= FuncDef;
```

说明一个 `CompUnit` 中包含一个 `FuncDef`，因此可以写成：

```cpp
class CompUnitAST : public BaseAST {
public:
    std::unique_ptr<BaseAST> func_def;
};
```

类似地：

```text
FuncDef ::= FuncType IDENT "(" ")" Block;
```

可以对应：

```cpp
class FuncDefAST : public BaseAST {
public:
    std::unique_ptr<BaseAST> func_type;
    std::string ident;
    std::unique_ptr<BaseAST> block;
};
```

这里需要注意，文法中的每个符号并不一定都要在 AST 中单独建立节点。

例如：

```text
(
)
{
}
;
```

这些符号只是用来约束源代码的语法形式，一旦语法分析完成，它们就没有必要继续保留。

类似地：

```text
int
return
```

通常也不需要作为独立节点保存。因为一旦我们已经构造了 `FuncTypeAST` 或 `ReturnStmtAST`，节点类型本身就已经表达了对应的语义。

而：

```text
IDENT
INT_CONST
```

则不同。

例如：

```c
int main() {
    return 123;
}
```

其中：

```text
main
123
```

都是程序本身携带的数据，因此必须在 AST 中保存，例如：

```cpp
std::string ident;
int value;
```

所以

> 是否需要建立节点或者保存字段，取决于这部分信息对后续编译阶段是否仍然有意义。

这也是 AST 与普通语法树的一个重要区别。

如果严格按照 EBNF 的每一层都建立节点，那么得到的结构更接近 **CST（Concrete Syntax Tree，具体语法树）**。

而 AST 会主动省略很多只服务于语法分析的细节。

例如：

```text
Stmt ::= "return" Number ";";
```

理论上完全可以直接设计成：

```cpp
class ReturnStmtAST : public BaseAST {
public:
    int value;
};
```

而不一定非要保留：

```text
StmtAST
└── NumberAST
```

不过在当前实验中，为了更直观地理解 Bison 如何逐层构造 AST，我们暂时让 AST 的结构和 EBNF 保持得比较接近。

### 生成 AST

设计好 AST 之后，就可以在 Bison 的语法动作中真正构造这些节点了。

在上一节中，我们对每个语法单元的处理方式都是：

```cpp
std::string *
```

每完成一次规约，就把对应的内容重新拼成字符串。

现在我们要把它替换成：

```text
BaseAST *
```

也就是说：

> Bison 每完成一次规约，就构造一个对应的 AST 节点，并将这个节点继续向上传递。

首先修改 `src/sysy.y`。

我们需要让 Bison 生成的头文件能够看到 `BaseAST` 的定义，因此：

```text
%code requires {
  #include <memory>
  #include <string>
  #include "ast.hpp"
}
```

这里使用的是：

```text
%code requires
```

而不是单纯的：

```text
%{
...
%}
```

原因是 Bison 不仅会生成：

```text
sysy.tab.cpp
```

还会生成：

```text
sysy.tab.hpp
```

而 `%union` 等声明可能需要出现在生成的头文件中。

因为这些声明中会使用：

```text
BaseAST *
```

所以 `ast.hpp` 也必须在生成的头文件中可见。

接下来，将 parser 的额外参数从：

```text
%parse-param { std::unique_ptr<std::string> &ast }
```

修改为：

```text
%parse-param { std::unique_ptr<BaseAST> &ast }
```

这样，语法分析完成以后，得到的根节点就可以通过：

```cpp
std::unique_ptr<BaseAST> ast;
```

传回 `main` 函数。

接下来修改 `%union`：

```text
%union {
  std::string *str_val;
  int int_val;
  BaseAST *ast_val;
}
```

在上一节中，非终结符的语义值都是：

```cpp
std::string *
```

现在则改成 AST 节点指针：

```text
%type <ast_val> FuncDef FuncType Block Stmt Number
```

这样，像 `FuncDef`、`Block` 这样的非终结符在完成规约以后，返回的就是一个 AST 节点。

首先来看：

```text
CompUnit ::= FuncDef;
```

对应的 Bison 代码可以写成：

```text
CompUnit
  : FuncDef {
      auto comp_unit = std::make_unique<CompUnitAST>();

      comp_unit->func_def =
          std::unique_ptr<BaseAST>($1);

      ast = std::move(comp_unit);
    }
  ;
```

这里：

```text
$1
```

表示产生式右侧第一个符号，也就是 `FuncDef` 的语义值。

因为：

```text
%type <ast_val> FuncDef
```

所以 `$1` 的实际类型就是：

```text
BaseAST *
```

接下来：

```text
std::unique_ptr<BaseAST>($1)
```

将这个裸指针交给 `unique_ptr` 管理。

最后：

```cpp
ast = std::move(comp_unit);
```

把当前构造出的 `CompUnitAST` 交给 parser 的输出参数 `ast`。

这里涉及 `unique_ptr` 的所有权转移。

例如：

```cpp
auto comp_unit = std::make_unique<CompUnitAST>();
```

此时 AST 对象由：

```text
comp_unit
```

独占管理。

而 `unique_ptr` 不能被复制，因此不能直接：

```text
ast = comp_unit;
```

而需要：

```cpp
ast = std::move(comp_unit);
```

表示：

```text
comp_unit
    │
    │ 所有权转移
    ▼
   ast
```

执行之后，AST 对象由 `ast` 管理，而原来的 `comp_unit` 会变成空指针。

因此，这里的 `std::move` 并不是把 AST 对象本身“搬走”，而是把：

> 对这个 AST 对象的所有权从一个 `unique_ptr` 转移给另一个 `unique_ptr`。

接下来处理：

```text
FuncDef ::= FuncType IDENT "(" ")" Block;
```

可以写成：

```text
FuncDef
  : FuncType IDENT '(' ')' Block {
      auto ast = new FuncDefAST();

      ast->func_type =
          std::unique_ptr<BaseAST>($1);

      ast->ident =
          *std::unique_ptr<std::string>($2);

      ast->block =
          std::unique_ptr<BaseAST>($5);

      $$ = ast;
    }
  ;
```

这里：

```text
$1
$2
$3
$4
$5
```

分别表示：

```text
FuncType IDENT '(' ')' Block
   $1     $2   $3  $4   $5
```

而：

```text
$$
```

表示产生式左侧 `FuncDef` 的语义值。

因此：

```text
$$ = ast;
```

表示：

> 当前这些符号规约成 `FuncDef` 后，`FuncDef` 对应的 AST 节点就是刚刚构造出的 `FuncDefAST`。

整个过程可以理解成：

```text
FuncType IDENT '(' ')' Block
               │
               │ 规约
               ▼
           FuncDefAST
```

然后这个节点会继续作为 `$1`、`$2` 等语义值被更上层的规则使用。

对于：

```text
FuncType ::= "int";
```

可以写成：

```text
FuncType
  : INT {
      auto ast = new FuncTypeAST();
      $$ = ast;
    }
  ;
```

因为当前只支持 `int` 一种函数返回类型，所以 `FuncTypeAST` 暂时不需要保存额外的数据。

以后如果支持：

```text
int
void
float
```

等不同类型，再在 `FuncTypeAST` 中添加对应字段即可。

其他规则也可以按照完全相同的方法构造 AST。

整个过程本质上就是：

```text
Token
  │
  ▼
Bison 规约
  │
  ├── NumberAST
  │
  ▼
StmtAST
  │
  ▼
BlockAST
  │
  ▼
FuncDefAST
  │
  ▼
CompUnitAST
```

随着语法分析不断进行，较小的 AST 节点被逐步组合成较大的 AST 节点，最终形成整棵树。

parser 参数改变以后，`yyerror` 也需要同步修改：

```cpp
void yyerror(
    std::unique_ptr<BaseAST> &ast,
    const char *s) {
    ...
}
```

同时，`main.cpp` 中原来的：

```cpp
extern int yyparse(unique_ptr<string> &ast);
```

也需要改成：

```cpp
extern int yyparse(unique_ptr<BaseAST> &ast);
```

这样，语法分析器最终返回的就不再是一个字符串，而是一棵真正的 AST。

### 检查生成结果

现在 AST 已经可以正确构造出来了，但它暂时只保存在内存中。

为了检查生成结果是否符合我们的预期，我们希望能够把整棵 AST 打印到终端。

可以利用 C++ 的虚函数机制，在 `BaseAST` 中增加一个统一的：

```text
Dump()
```

接口：

```cpp
class BaseAST {
public:
    virtual ~BaseAST() = default;

    virtual void Dump() const = 0;
};
```

这里：

```text
= 0
```

表示 `Dump()` 是一个**纯虚函数**。

因此，`BaseAST` 本身不能直接实例化，而所有具体的 AST 节点都需要实现自己的 `Dump()`。

例如：

```cpp
class CompUnitAST : public BaseAST {
public:
    std::unique_ptr<BaseAST> func_def;

    void Dump() const override {
        std::cout << "CompUnitAST { ";
        func_def->Dump();
        std::cout << " }";
    }
};
```

类似地：

```cpp
class FuncDefAST : public BaseAST {
public:
    std::unique_ptr<BaseAST> func_type;
    std::string ident;
    std::unique_ptr<BaseAST> block;

    void Dump() const override {
        std::cout << "FuncDefAST { ";

        func_type->Dump();

        std::cout << ", "
                  << ident
                  << ", ";

        block->Dump();

        std::cout << " }";
    }
};
```

虽然：

```text
func_def
func_type
block
```

这些字段的静态类型都是：

```cpp
std::unique_ptr<BaseAST>
```

但它们实际指向的对象可能分别是：

```text
FuncDefAST
FuncTypeAST
BlockAST
```

由于 `Dump()` 是虚函数，所以调用：

```cpp
func_def->Dump();
```

时，C++ 会根据对象的实际类型自动调用正确的 `Dump()` 实现。

这就是 C++ 中的**运行时多态**。

最后，在 `main.cpp` 中：

```cpp
std::unique_ptr<BaseAST> ast;

auto ret = yyparse(ast);
assert(!ret);

ast->Dump();
std::cout << std::endl;
```

对于输入：

```c
int main() {
    return 0;
}
```

最终可以得到类似：

```text
CompUnitAST {
  FuncDefAST {
    FuncTypeAST { int },
    main,
    BlockAST {
      StmtAST { 0 }
    }
  }
}
```

这样的输出。

整个编译前端到这里已经形成：

```text
源代码
  │
  ▼
Flex
  │
  ▼
Token Stream
  │
  ▼
Bison
  │
  ▼
AST
```

相比上一节单纯把内容重新拼接成字符串，现在的语法分析器已经真正把源程序转换成了一种结构化表示。

换句话说，之前我们主要是在判断：

```text
这个程序是否符合语法？
```

而现在，在确认程序符合语法的同时，我们还得到了：

```text
这个程序的结构是什么？
```

这棵 AST 也将成为后续生成 Koopa IR 的基础。

## IR生成

在上一节中，我们已经成功让编译器能够将简单的 SysY 程序解析为 AST。在此基础上，就可以继续进行后续的编译工作，例如生成中间表示（IR）。

在实际的编译器实现中，通常没有必要从头实现完整的后端。借助 LLVM IR 等成熟的编译基础设施，我们可以将源程序转换为统一的中间表示，再把后续的优化、指令选择、寄存器分配以及机器码生成等工作交给现有工具链完成。

因此，本小节将继续完善我们的编译器，实现从 AST 到 IR 的转换。

### Koopa IR 基础

在 Koopa IR 中，最大的结构单位是 `Program`，它代表一个完整的 Koopa IR 程序。

一个 `Program` 由若干全局值（`Value`）和函数（`Function`）组成。其中，每个 `Function` 又由若干基本块（`BasicBlock`）构成，而基本块中则包含一系列指令。需要注意的是，在 Koopa IR 中，**指令本身也是一种 `Value`**。

因此，一个 Koopa IR 程序的基本结构如下：

```text
Program
├── Global Values
│
└── Functions
    └── Function
        └── BasicBlocks
            └── BasicBlock
                └── Values / Instructions
```

接下来，我们重点介绍其中涉及到的几个基本概念。

首先是**基本块（Basic Block）**。基本块可以理解为一系列连续执行的指令，它具有以下特点：

- **只有一个入口点**：如果其他基本块要将控制流转移到当前基本块，只能跳转到基本块的开头，而不能直接跳到基本块中间的某条指令。
- **控制流只能在末尾发生转移**：基本块中只有最后一条指令可以改变控制流，例如跳转到其他基本块，或者从当前函数中返回（执行 `return`）。

基本块的存在能够简化编译过程中大量与控制流相关的分析，因此 Koopa IR 要求函数中的指令按照基本块进行组织。

同时，Koopa IR 约定函数的第一个基本块为函数的**入口基本块**。也就是说，当函数开始执行时，会首先从第一个基本块开始执行。

在本次实验中，我们暂时不需要考虑全局变量。同时，也可以暂时认为 `Program` 的函数列表中只有一个 `Function`，而这个 `Function` 中又只有一个 `BasicBlock`，也就是函数的入口基本块。

基本块中包含的指令同样属于 `Value`。Koopa IR 中主要包含以下几类 `Value`（更详细的介绍可以参考：[文档](https://docs.rs/koopa/latest/koopa/ir/entities/enum.ValueKind.html)）：

- **各类常量**：整数常量（`Integer`）、零初始化器（`ZeroInit`）等。
- **参数引用**：例如函数参数引用（`FuncArgRef`），用于表示传入函数的参数。
- **内存分配**：全局内存分配（`GlobalAlloc`，全局变量通过它表示）和局部内存分配（`Alloc`）。
- **访存指令**：加载（`Load`）和存储（`Store`）。
- **指针运算**：`GetPtr` 和 `GetElemPtr`。
- **二元运算**：`Binary`，例如加、减、乘、除、取模以及各种比较运算。
- **控制流转移**：条件分支（`Branch`）和无条件跳转（`Jump`）。
- **函数相关操作**：函数调用（`Call`）和函数返回（`Return`）。

在本节实验中，我们实际会用到的只有两种：**整数常量 `Integer`** 和**函数返回 `Return`**。

至此，我们需要生成的 Koopa IR 就已经非常明确了：

1. 生成一个 Koopa IR `Program`。
2. `Program` 中包含一个名为 `main` 的函数。
3. 函数中包含一个基本块。
4. 基本块中包含一条返回指令。
5. 返回指令的返回值，就是 SysY 中 `return` 语句后面的整数常量。

如果手动编写对应的 Koopa IR，它大致如下：

```text
fun @main(): i32 {
%entry:
    ret 0
}
```

这里还有几个需要注意的地方：

1. <strong>符号名称的规范。</strong>可以看到，这里的函数名是 `@main`，而不是之前 SysY 程序中的 `main`。这是因为 Koopa IR 规定，`Function`、`BasicBlock` 和具名 `Value` 的名字必须以 `@` 或 `%` 开头。`@` 和 `%` 在语义上并没有本质区别，但在使用习惯上，我们通常使用 `@` 表示源程序中本身就存在的符号，例如函数名和全局变量名；而使用 `%` 表示编译器在生成 IR 的过程中产生的局部符号或临时值。因此：`@main`对应的是 SysY 程序中的 `main`.而：`%entry`则是我们在生成 IR 时人为创建的基本块名称。
2. <strong>Koopa IR 是一种强类型 IR。</strong>也就是说，函数参数、函数返回值以及各种 `Value` 都具有明确的类型。例如：`fun @main(): i32`中的 `i32` 表示 `main` 函数的返回值类型为 32 位整数，对应 SysY 中的 `int`。不过，我们并不需要在文本形式的 Koopa IR 中为每一个值都显式写出类型。很多情况下，Koopa IR 的解析器可以根据上下文推导出对应的类型，因此可以省略一部分类型标注。例如：`ret 0`中并没有显式写出 `0` 的类型，但根据当前函数的返回类型以及 `ret` 指令的语义，可以确定这里返回的是一个 `i32` 整数。
3. <strong>基本块的名字可以自行指定。</strong>基本块叫什么并不会影响程序语义，例如 `%entry`、`%start` 等都可以使用。不过，给基本块起一个具有实际含义的名字，通常能够让生成的 IR 更容易阅读，也更方便我们在后续调试编译器时定位问题。

### 生成 Koopa IR（1）——Koopa IR 数据结构

生成 Koopa IR 最直接的方式，其实和我们之前在命令行中输出 AST 很类似：给不同的 AST 节点实现对应的输出逻辑，然后遍历 AST，直接输出 Koopa IR 文本即可。

不过在正式实现之前，我们先区分 Koopa IR 的两种表示形式：

- **文本形式**：也就是字符串形式，主要方便人阅读、调试以及在不同工具之间传递。
- **内存形式**：也就是使用程序中的数据结构来表示 IR，方便编译器对其进行遍历、分析和修改。

我们的编译器最终需要输出文本形式的 Koopa IR。之后，这些文本 IR 可以被 `koopac` 等 Koopa IR 工具读取并解析为内存形式，以进行进一步处理。Koopa IR 框架本身也提供了相关接口，用于处理不同形式的 IR。

因此，考虑到上述情况，我们主要有两种实现思路：

1. 遍历 AST，直接输出文本形式的 IR。这种方式最简单，也适用于使用任意语言实现的编译器。
2. 像定义 AST 一样，定义一套表示 Koopa IR 的数据结构，例如指令、基本块和函数等。首先遍历 AST 生成这些 IR 数据结构，然后再遍历 IR，将其输出为字符串。

虽然第一种方案最简单，但从工程结构上看，它实际上把两个不同的过程：

```text
AST -> IR
IR -> Text
```

杂糅在了一起，不利于后续扩展和维护。

因此，我们选择第二种方案。此时整个流程变成：

```text
AST
 ↓
IR Generation
 ↓
Koopa IR 内存结构
 ↓
IR Printer
 ↓
Koopa IR 文本
```

也就是说，**AST 不负责输出 Koopa IR 字符串，IR 数据结构也不需要理解 AST**，二者之间通过 IR Generation，也就是 AST 到 IR 的转换过程连接起来。

目前，我们并不需要一开始就实现完整的 Koopa IR 数据结构。根据本次实验的要求，我们只需要支持如下结构：

```text
Program
└── Function
    └── BasicBlock
        └── Value
            ├── Integer
            └── Instruction
                └── Return
```

下面我们来具体设计 Koopa IR 的数据结构。

根据 Koopa IR 的设计，一个完整的程序由若干 `Function` 和全局 `Value` 组成，而每个 `Function` 又由若干 `BasicBlock` 组成，`BasicBlock` 中包含一系列指令。

与此同时，**指令本身也属于 `Value` 的一种**。因此，`Value` 可以看作 Koopa IR 中最基础的抽象之一。

我们首先使用枚举表示不同种类的 `Value`。同时，为了表示 IR 中的数据类型，再额外定义 `IRType`：

```cpp
enum class ValueKind
{
    Integer,
    Return
};

enum class IRType
{
    I32,
};
```

其中需要注意：

- `ValueKind` 表示当前 IR 节点“是什么”，例如整数常量还是 `Return` 指令。
- `IRType` 表示数据本身的类型，例如这里的 `I32`。

有了 `ValueKind` 后，我们就可以定义所有 IR Value 的基类 `IRValue`：

```cpp
class IRValue
{
public:
    const ValueKind kind;
    virtual ~IRValue() = default;

protected:
    explicit IRValue(ValueKind kind)
        : kind(kind) {}
};
```

`kind` 用来记录当前 `IRValue` 的具体种类，而构造函数被声明为 `protected`，因为我们并不会直接创建一个普通的 `IRValue`，而是通过其派生类创建具体的 IR 节点。

在此基础上，可以进一步派生出当前实验需要的两类 Value：

```cpp
class IRInteger : public IRValue
{
public:
    int value;

    explicit IRInteger(int value)
        : IRValue(ValueKind::Integer),
          value(value) {}
};

class Instruction : public IRValue
{
protected:
    explicit Instruction(ValueKind kind)
        : IRValue(kind) {}
};
```

其中，`IRInteger` 表示整数常量，而 `Instruction` 表示所有指令的公共基类。

这里体现了一个很重要的关系：

```text
IRValue
├── IRInteger
└── Instruction
```

也就是说，**所有指令都是 `Value`，但并不是所有 `Value` 都是指令**。例如整数常量 `IRInteger` 是一个 `Value`，但它并不是一条指令。

而 `Instruction` 又可以进一步派生出具体的指令类型。例如本次实验中需要使用的 `Return`：

```cpp
class Return : public Instruction
{
public:
    std::unique_ptr<IRValue> operand;

    explicit Return(std::unique_ptr<IRValue> operand)
        : Instruction(ValueKind::Return),
          operand(std::move(operand)) {}
};
```

这里的 `operand` 表示 `Return` 指令的返回值。

例如：

```text
return 42;
```

对应的 IR 数据结构可以理解为：

```text
Return
└── IRInteger(42)
```

需要注意的是，我们并没有把 `operand` 定义在 `Instruction` 基类中，而是让具体的指令自行维护自己的操作数。

这是因为不同指令拥有的操作数数量和含义并不相同。例如 `Return` 只有一个返回值，而后续的二元运算指令通常会有两个操作数。因此，把操作数交给具体指令管理会更加合理。

有了这些最基础的 IR 节点后，我们就可以进一步向上组织它们。

首先，多条指令共同组成一个 `BasicBlock`：

```cpp
class BasicBlock
{
public:
    std::string name;
    std::vector<std::unique_ptr<Instruction>> insts;

    explicit BasicBlock(std::string name)
        : name(std::move(name)) {}
};
```

这里需要注意，`BasicBlock` 中保存的是：

```cpp
std::vector<std::unique_ptr<Instruction>>
```

而不是所有 `IRValue`。

这是因为基本块本质上包含的是一系列需要依次执行的**指令**。虽然 `Instruction` 同时也是一种 `IRValue`，但像 `IRInteger` 这样的常量并不会单独作为一条指令出现在基本块的指令列表中。

若干个 `BasicBlock` 又共同组成一个 `Function`：

```cpp
class Function
{
public:
    std::string name;
    IRType ret_type;
    std::vector<std::unique_ptr<BasicBlock>> bbs;

    Function(std::string name, IRType ret_type)
        : name(std::move(name)),
          ret_type(ret_type) {}
};
```

其中：

- `name` 表示函数名称；
- `ret_type` 表示函数返回值类型；
- `bbs` 保存函数中的所有基本块。

最后，若干个 `Function` 组成整个 `Program`：

```cpp
class Program
{
public:
    std::vector<std::unique_ptr<Function>> funcs;
};
```

完整的 Koopa IR `Program` 实际上还可以包含全局 `Value`，不过在当前 Lv1 实验中并不会使用到，因此这里暂时只保存函数。

至此，我们就完成了当前实验所需要的 Koopa IR 数据结构设计：

```text
Program
└── Function
    └── BasicBlock
        └── Instruction
            └── Return
                └── IRInteger
```

有了这套内存中的 IR 表示后，接下来就可以完成两件事情：

```text
AST
 ↓
生成 Koopa IR 数据结构
 ↓
IR Printer
 ↓
Koopa IR 文本
```

也就是说，下一步真正需要实现的，就是 **AST 到 Koopa IR 的转换**。

### 生成 Koopa IR（2）——Koopa IR 转换与打印

从 AST 到 Koopa IR 的转换并不复杂，在实现思路上，我们完全可以参考之前输出 AST 时使用的 `Dump`：从根节点开始，递归遍历整棵 AST，并根据不同类型的 AST 节点生成对应的 IR 节点。

不过，为了保持上一节中确定的设计，我们并不会直接在 AST 中实现 IR 生成逻辑，而是单独设计一个 `IRGenerator`，负责：

```text
AST -> Koopa IR
```

同时，再使用 `IRPrinter` 负责：

```text
Koopa IR -> Text
```

这样做虽然相比直接在 AST 中添加一个 `DumpIR` 方法多了一层结构，但也带来了一个明显的好处：

- 如果我们想了解 **AST 是如何转换成 IR 的**，直接查看 `IRGenerator` 即可；
- 如果我们想了解 **IR 是如何被打印成 Koopa IR 文本的**，直接查看 `IRPrinter` 即可。

这样就不需要在 AST 的各种节点中频繁切换上下文，也使不同模块之间的职责更加清晰。

整个过程可以表示为：

```text
AST
 ↓
IRGenerator
 ↓
Koopa IR 内存结构
 ↓
IRPrinter
 ↓
Koopa IR 文本
```

我们先来看<strong>AST 到 Koopa IR 的转换。</strong>实现上，我们可以单独创建：

```text
src/ir_generator.hpp
src/ir_generator.cpp
```

然后采用类似 `Dump` 的递归思路，根据不同的 AST 节点生成对应的 Koopa IR 数据结构。

首先，从最外层的 `CompUnitAST` 开始：

```cpp
Program IRGenerator::Generate(const CompUnitAST& ast) const
{
    Program program;

    const auto& func =
        static_cast<const FuncDefAST&>(*ast.func_def);

    program.funcs.push_back(GenerateFunction(func));

    return program;
}
```

当前实验中，一个 `CompUnitAST` 中只包含一个函数定义，因此我们取出其中的 `FuncDefAST`，生成对应的 `Function`，并加入 `Program` 中。

接下来处理函数定义：

```cpp
std::unique_ptr<Function>
IRGenerator::GenerateFunction(const FuncDefAST& ast) const
{
    auto func =
        std::make_unique<Function>(ast.ident, IRType::I32);

    auto entry =
        std::make_unique<BasicBlock>("entry");

    const auto& block =
        static_cast<const BlockAST&>(*ast.block);

    EmitBlock(block, *entry);

    func->bbs.push_back(std::move(entry));

    return func;
}
```

在当前实验中，函数返回类型一定是 `int`，因此可以直接将其转换为 Koopa IR 中的 `I32`。

与此同时，我们为函数创建一个名为 `entry` 的入口基本块，然后将函数体中的语句转换成对应的指令，并插入这个基本块。

对于 `BlockAST`：

```cpp
void IRGenerator::EmitBlock(
    const BlockAST& ast,
    BasicBlock& bb) const
{
    const auto& stmt =
        static_cast<const StmtAST&>(*ast.stmt);

    EmitStmt(stmt, bb);
}
```

当前实验中，一个 `Block` 中只有一条 `Stmt`，因此继续递归处理即可。

接下来处理 `StmtAST`：

```cpp
void IRGenerator::EmitStmt(
    const StmtAST& ast,
    BasicBlock& bb) const
{
    const auto& number =
        static_cast<const NumberAST&>(*ast.number);

    bb.insts.push_back(
        std::make_unique<Return>(
            GenerateNumber(number)
        )
    );
}
```

当前语法中的 `Stmt` 只有：

```text
return Number;
```

因此，我们首先将 `NumberAST` 转换成一个 `IRInteger`，然后将其作为操作数构造 `Return` 指令，最后把这条指令加入当前基本块。

最后是最底层的 `NumberAST`：

```cpp
std::unique_ptr<IRValue>
IRGenerator::GenerateNumber(const NumberAST& ast) const
{
    return std::make_unique<IRInteger>(ast.value);
}
```

这样，一个类似：

```c
int main() {
    return 0;
}
```

的 AST：

```text
CompUnitAST
└── FuncDefAST
    ├── main
    └── BlockAST
        └── StmtAST
            └── NumberAST(0)
```

经过 `IRGenerator` 后，就会得到：

```text
Program
└── Function("main")
    └── BasicBlock("entry")
        └── Return
            └── IRInteger(0)
```

这就完成了：

```text
AST -> Koopa IR
```

的转换。

接着我们看**Koopa IR 的打印**。有了内存形式的 Koopa IR 后，接下来只需要按照 Koopa IR 的文本格式，将这些数据结构依次输出即可。

其过程同样是从 `Program` 开始递归向下遍历：

```cpp
std::string IRPrinter::Print(const Program& program) const
{
    std::string result;

    for (const auto& func : program.funcs)
    {
        result += PrintFunction(*func);
    }

    return result;
}
```

然后打印 `Function`：

```cpp
std::string
IRPrinter::PrintFunction(const Function& func) const
{
    std::string result;

    result += "fun @" + func.name + "(): ";

    if (func.ret_type == IRType::I32)
    {
        result += "i32";
    }

    result += " {\n";

    for (const auto& bb : func.bbs)
    {
        result += PrintBasicBlock(*bb);
    }

    result += "}\n";

    return result;
}
```

再依次打印函数中的基本块：

```cpp
std::string
IRPrinter::PrintBasicBlock(const BasicBlock& bb) const
{
    std::string result;

    result += "%" + bb.name + ":\n";

    for (const auto& inst : bb.insts)
    {
        result += "  ";
        result += PrintInstruction(*inst);
        result += "\n";
    }

    return result;
}
```

对于具体指令，我们根据 `ValueKind` 判断指令类型：

```cpp
std::string
IRPrinter::PrintInstruction(const Instruction& inst) const
{
    switch (inst.kind)
    {
    case ValueKind::Return:
    {
        const auto& ret =
            static_cast<const Return&>(inst);

        return "ret " + PrintOperand(*ret.operand);
    }

    default:
        throw std::logic_error("invalid instruction kind");
    }
}
```

这里虽然传入的是 `Instruction&`，但在判断出它的 `kind` 为 `Return` 后，我们就知道这个对象实际是一个 `Return`，因此可以通过 `static_cast` 将其转换为具体的 `Return` 类型，从而访问其中的 `operand`。

同样，对于操作数：

```cpp
std::string
IRPrinter::PrintOperand(const IRValue& value) const
{
    switch (value.kind)
    {
    case ValueKind::Integer:
    {
        const auto& integer =
            static_cast<const IRInteger&>(value);

        return std::to_string(integer.value);
    }

    default:
        throw std::logic_error("invalid operand kind");
    }
}
```

如果这个 `IRValue` 的类型为 `Integer`，那么它实际对应的是 `IRInteger`，因此将其转换成 `IRInteger` 后即可取得其中保存的整数值。

至此，我们就完成了：

```text
Koopa IR 内存结构
 ↓
IRPrinter
 ↓
Koopa IR 文本
```

这一过程。

最后我们来看如何<strong>在主程序中使用。</strong>实现完 `IRGenerator` 和 `IRPrinter` 后，最后只需要在 `main` 中将它们串联起来：

```cpp
IRGenerator generator;
auto program =
    generator.Generate(
        static_cast<const CompUnitAST&>(*ast)
    );

IRPrinter printer;
auto koopa = printer.Print(program);

std::ofstream koopa_file(output);
assert(koopa_file);

koopa_file << koopa;
```

这样，我们完整的编译流程就变成了：

```text
SysY 源代码
 ↓
词法分析 / 语法分析
 ↓
AST
 ↓
IRGenerator
 ↓
Koopa IR 内存结构
 ↓
IRPrinter
 ↓
Koopa IR 文本
```

对于：

```c
int main() {
    return 0;
}
```

最终就可以生成：

```text
fun @main(): i32 {
%entry:
  ret 0
}
```

至此，我们就完成了从 SysY AST 到 Koopa IR 的第一次完整转换。

至此，Exp Chapter 1的实验就全部完成了！我们成功的将一个简单的带有main函数的SysY代码编译为了Koopa IR程序！
