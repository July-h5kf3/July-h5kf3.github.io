---
title: "[从零开始的编译原理][实验] Exp Chapter 5：语句块与作用域"
date: 2026-11-17T22:00:00+08:00
slug: compiler-exp5-scope
categories:
    - 编译原理
column:
    - 编译原理
tags:
    - 编译原理
    - 编译器实验
    - 作用域
    - 语句块
    - 符号表
    - Koopa IR
seriesOrder: 9
math: true
comments: false
---

在上一章中，我们实现了编译器对变量与常量的支持，并引入了**符号表（Symbol Table）**这一核心数据结构来维护标识符信息。但此前的实现仅局限于函数体内的单一代码块；而在实际的源程序中，函数内部往往包含由花括号 `{}` 划定的多个并列或嵌套的代码块。

随着代码块层级的切换，标识符的可见性与生命周期也会动态变化，单一的扁平符号表已无法满足需求，需要演进为支持层级结构的符号表。为此，在本章中我们将正式引入语句块与作用域的概念：

- 语句块（Block）：由一对花括号 `{ ... }` 包裹的语法结构，内部可以包含零条或多条声明语句（变量/常量声明）与执行语句。在语法层面上，语句块在许多上下文中被视为单条语句，支持任意层级的相互嵌套（例如函数体本身，以及后续 `if`、`while` 分支中的块结构），是划分程序局部空间的天然语法边界。

- 作用域（Scope）：程序中某一个标识符（变量或常量）合法且可见的代码区域。编译器通常遵循**词法作用域**规则：

    - 可见性与生命周期：在某个语句块内声明的标识符，其作用域从声明处开始，直至该语句块结束（遇到右花括号 `}`）为止；离开该语句块后，对应的符号表项即随之失效。

    - 嵌套与遮蔽：内层语句块可以直接访问外层语句块中已声明的标识符；若内层声明了与外层同名的标识符，则在内层作用域中会暂时“遮蔽”外层的同名定义，并在退出内层语句块后自动恢复外层标识符的可见性。

    - 重定义检查：在同一个作用域层级内，不允许对同名标识符进行重复声明；但在不同（嵌套或并列）的作用域中，同名标识符的声明是完全合法的。

我们依然按照“词法/语法分析 $\rightarrow$ 语义分析 $\rightarrow$ IR 生成与目标代码生成”的脉络推进本章的实现。

在本章中，我们新增 or 变更的词法，语法结构如下:

```text
Stmt ::= LVal "=" Exp ';'
       | [Exp] ';'
       | Block
       | "return" Exp ';';
```

本小节后，我们的编译器应该可以处理这样的SysY代码:

```c
int main() {
  int a = 1, b = 2;
  {
    int a = 2;
    b = b + a;
  }
  return b;
}
```

## 词法/语法分析

观察新的 EBNF 语法可以发现，词法部分没有任何新增 Token，改动主要集中在 `Stmt` 的产生式上，新增了两类形式：

1. `[Exp] ";"`：EBNF 中的方括号 `[...]` 表示括号内的符号是可选的（出现 0 次或 1 次）。因此它实际上涵盖了两种语句：

    - 表达式语句 `Exp ";"`：例如 `1 + 2;`（或后续带副作用的函数调用），编译器需要照常计算表达式的值，但丢弃最终结果。

    - 空语句 `";"`：单独一个分号，不执行任何操作。

2. `Block`：语句块本身也可以作为一条语句出现，从而天然支持 `{ { ... } }` 的任意层级嵌套。

由于 Bison 采用标准 BNF 语法，不支持直接书写 `[Exp]`，我们将其拆分为 `Exp ';'` 和 `';'` 两条并列分支即可

```cpp
Stmt
  : LVal '=' Exp ';' {
    auto ast = new StmtAST();
    ast->exp = unique_ptr<BaseAST>($3);
    ast->lval = unique_ptr<BaseAST>($1);
    ast->kind = StmtAST::Kind::Assignment;
    $$ = ast;
  }
  | Exp ";" {
    auto ast = new StmtAST();
    ast->exp = unique_ptr<BaseAST>($1);
    ast->kind = StmtAST::Kind::Exp;
    $$ = ast;
  }
  | ";" {
    auto ast = new StmtAST();
    ast->kind = StmtAST::Kind::Empty;
    $$ = ast;
  }
  | Block {
    auto ast = new StmtAST();
    ast->block = unique_ptr<BaseAST>($1);
    ast->kind = StmtAST::Kind::Block;
    $$ = ast;
  }
  | RETURN Exp ';' {
    auto ast = new StmtAST();
    ast->exp = unique_ptr<BaseAST>($2);
    ast->kind = StmtAST::Kind::Return;
    $$ = ast;
  }
  ;
```

相应地，在 `StmtAST` 中新增 `block` 指针成员，并将 `StmtAST::Kind` 枚举扩展为 `{ Return, Assignment, Empty, Exp, Block }`。对于 `Empty` 和 `Block` 分支，`exp` 保持默认的 `nullptr` 即可。

## 语义分析

上一章实现的 `SymbolTable` 内部仅维护了一张 `std::unordered_map`，只能表示单一扁平作用域。为了支持嵌套与多作用域，我们需要对其进行升级，满足以下四点核心需求：

在本节中，我们需要对这个符号表做一定的更改，使其

1. 支持作用域的嵌套：在实现上，我们将会为每个作用域分配一个符号表，同时采用**栈**来维护每个符号表之间的层次关系

2. 在进入和退出代码块时更新符号表的层次结构：进入代码块时，在这个结构里新建一个符号表，这个符号表就代表当前作用域的符号表；退出代码块时，删除刚刚创建的符号表，进入代码块之前的那个符号表就是当前的符号表。

3. 只在当前作用域添加符号：也就是说, 只在当前层次的符号表中插入符号定义.

4. 能跨越作用域查询符号定义：在查询符号定义时, 先在当前符号表中查询, 如果找不到就去上一层中查询. 如果在所有符号表中都没有找到这个符号的定义, 说明输入的 SysY 程序存在语义错误.


这里简单说说为什么用栈而不是树，因为我们在理论学习的时候很多时候会把这个结构画成一个树状结构。


从静态语法结构看，嵌套代码块确实构成一棵树；但从编译器DFS AST 的动态视角看，兄弟代码块在退出后即失效，任意时刻只有从最外层作用域到当前作用域的这一条活跃路径需要保留，呈现出标准的LIFO特征。

因此，我们直接将单层符号表定义为 `Scope`，并用 `std::vector<Scope>` 来模拟作用域栈

那么显然:

- `scopes_.back()`也就是栈顶就是我们的CurrentScope，新符号只会往这里面插入

- `scopes_.front()`：也就是栈底，代表最外层作用域

相应地，对于我们而言，进入和退出作用域就相当于入栈和出栈:

```cpp
void EnterScope()
{
  scopes_.emplace_back();
}
void ExitScope()
{
  if(scopes_.empty()) throw std::runtime_error("No active scope");
  scopes_.pop_back();
}
```

相应的，我们需要对`Lookup`函数进行更改来保证能够跨作用域进行符号的查询:

```cpp
const Symbol& Lookup(const std::string& name) const
{
  for( auto it = scopes_.rbegin(); it != scopes_.rend(); ++it)
  {
        auto found = it->find(name);
        if( found != it->end()) return found->second;
  }
     throw std::runtime_error("Undefined symbol: " + name);
}
```

至此，这个数据结构就能很好的表示嵌套作用域了！

## IR 生成 & CodeGen

我们之前提到，我们会在进入或退出Block时发生作用域的变更，因此我们的更改除了基本的语法规则的适配外，还会包括`EmitBlock`中对作用域变更的适配，具体来说就是进入一个Block时的入栈和退出一个Block时的出栈。

为了防止以后中间提前return导致忘记`ExitScope()`,我们可以写一个`ScopeGuard`来将这个Enter和Exit自动化:

```cpp
class ScopeGuard
{
public:
    explicit ScopeGuard(SymbolTable& table) : table_(table)
    {
        table_.EnterScope();
    }
    ~ScopeGuard()
    {
        table_.ExitScope();
    }
    ScopeGuard(const ScopeGuard&) = delete;
    ScopeGuard& operator=(const ScopeGuard&) = delete;
private:
    SymbolTable& table_;
};
```

这样，我们只需要在`EmitBlock`的开头加入一个`ScopeGuard guard(ctx.symbol_table);`即可。


当我们引入了多作用域后，我们目前的代码很有可能一些错误:
首先我们看这样一个代码:

```c
int main()
{
    int a = 1;
    {
        int a = 2;
    }
    return a;
}
```

由于我们之前在变量定义中写的是:

```cpp
std::string ir_name = def.ident;
ctx.symbol_table.InsertVar(def.ident, ir_name);
```

那么这就会导致，生成的Koopa IR中出现两条

```text
@a = alloc i32
```

这不是Koopa IR允许的，因为我们在同一个函数内重定义了符号。同时，后端`ctx.stack_frame.offsets["a"]`会被覆盖成同一个栈偏移，内层修改 `a = 2` 会把外层的 `a` 也改掉！

解决方法很简单，我们在IRContext中维护一个新的计数器:`var_next_id`这样，就能完美区分了！

```cpp
std::string ir_name = def.ident + "_" + std::to_string(ctx.var_next_id++);
ctx.symbol_table.InsertVar(def.ident, ir_name);
```

这样这个问题就完美解决了！

接下来我们看看第二个问题:

```c
int main() {
    {
        return 1;
    }
    return 2;
}
```

在Koopa IR中规定，一个基本块（`BasicBlock`）必须以且仅以一条终结指令（如 `ret`）结尾，`ret` 之后不能再有任何指令。

如果 `return 1;` 已经向 `entry` 基本块发射了 `ret 1`，外层继续遍历时又往同一个 `entry` 基本块发射 `ret 2`（或者 `alloc`、`store`），Koopa 测试框架解析 IR 时会直接报错。

解决方法是我们可以在 `BasicBlock`加一个标记 `bool has_returned = false;` ：一旦当前基本块已经终结，后续 `EmitBlock` / `EmitStmt` / `EmitDecl` 遇到指令直接跳过不再发射。

这里简单说说为什么我们最终选择在`BasicBlock`中增加这个标记，而不是加入到IR Context。

这实际上还是为了后续扩展的考虑，在后续的实验中，我们还会加入`if/else`这样的语句，这样一个函数中会有多个`BasicBlock`.如果`then`分支里写了`return 1`，只是 `then` 这个基本块结束了，`else` 基本块还要继续生成指令！如果标志位绑在 `IRContext`（函数级）上，进 `else` 时还得手动改回去；而“不能在终结指令后继续发射指令”本质上是每个 `BasicBlock` 自身的属性。

实际上，你会发现我们的IR没有发生任何变化，那既然如此，CodeGen也没有啥变化。


至此我们的编译器已经能够支持作用域的嵌套了！
