---
title: "[从零开始的编译原理][实验] Exp Chapter 3：一元 / 二元表达式"
date: 2026-10-11T16:00:00+08:00
slug: compiler-exp3-expressions
categories:
    - 编译原理
column:
    - 编译原理
tags:
    - 编译原理
    - 编译器实验
    - 表达式
    - Koopa IR
    - RISC-V
seriesOrder: 6
math: true
comments: false
---

接下来，我们将在之前实现的编译器基础上，逐步加入对一元表达式和二元表达式的支持，目标是让编译器能够处理下面这样的程序：

```c
int main()
{
    return 1 + 2 * -3;
}
```

下面先从一元表达式开始。

## 一元表达式

一元表达式的实现依然沿用之前的编译流程：词法分析、语法分析、语义分析、IR 生成和目标代码生成。

本小节新增或调整的语法规则如下：

```text
Stmt        ::= "return" Exp ";";

Exp         ::= UnaryExp;
PrimaryExp  ::= "(" Exp ")" | Number;
Number      ::= INT_CONST;
UnaryExp    ::= PrimaryExp | UnaryOp UnaryExp;
UnaryOp     ::= "+" | "-" | "!";
```

这几条规则让编译器能够处理 `+`、`-` 和 `!` 三种一元运算，同时支持括号表达式。由于 `UnaryExp` 可以递归地出现在一元运算符之后，多个一元运算符也可以连续使用。

例如，本小节需要处理下面这样的程序：

```c
int main()
{
    return +(- -!6);  // 看起来像个颜文字
}
```

### 词法分析与语法分析

本小节新增了三个运算符：`+`、`-` 和 `!`。之前用 Flex 实现的词法分析器已经包含了匹配任意单个字符的规则，可以直接识别这三个符号，因此这里不需要修改词法规则。

语法分析部分则需要根据新的产生式，补充相应的 AST 节点。

这里首先要考虑的是：当一条产生式包含多个候选分支时，应该如何组织 AST？例如：

```text
PrimaryExp  ::= "(" Exp ")" | Number;
UnaryExp    ::= PrimaryExp | UnaryOp UnaryExp;
```

一种做法是为右侧的每个分支分别设计一个 AST 类，在解析到对应分支时构造相应的节点。另一种做法是只为左侧的非终结符设计一个 AST 类，再通过类型标记区分它对应的是哪一种情况。

我们的编译器采用后一种方式，用 `enum` 标记节点的具体类型。以 `UnaryExpAST` 为例：

```cpp
class UnaryExpAST : public BaseAST
{
public:
    enum class Kind { PrimaryExp, Unary };

    Kind kind;
    std::unique_ptr<BaseAST> primaryExp;
    std::unique_ptr<BaseAST> op;
    std::unique_ptr<BaseAST> unaryExp;

    void Dump() const override
    {
        std::cout << "UnaryExpAST { ";

        switch (kind)
        {
            case Kind::PrimaryExp:
            {
                primaryExp->Dump();
                break;
            }
            case Kind::Unary:
            {
                op->Dump();
                unaryExp->Dump();
                break;
            }
            default:
            {
                throw std::runtime_error("Invalid unary expression kind");
            }
        }

        std::cout << " }";
    }
};
```

当 `kind` 为 `PrimaryExp` 时，节点使用 `primaryExp` 保存基本表达式；当 `kind` 为 `Unary` 时，节点使用 `op` 保存一元运算符，使用 `unaryExp` 保存它作用的子表达式。

相应地，语法分析器也需要补充类型声明和语义动作。下面列出与 `Stmt`、`UnaryExp` 相关的部分，其余产生式按相同思路处理：

```text
%type <ast_val> FuncDef FuncType Block Stmt Number Exp UnaryExp UnaryOp PrimaryExp

Stmt
  : RETURN Exp ';' {
    auto ast = new StmtAST();
    ast->exp = std::unique_ptr<BaseAST>($2);
    $$ = ast;
  }
  ;

UnaryExp
  : PrimaryExp {
    auto ast = new UnaryExpAST();
    ast->kind = UnaryExpAST::Kind::PrimaryExp;
    ast->primaryExp = std::unique_ptr<BaseAST>($1);
    $$ = ast;
  }
  | UnaryOp UnaryExp {
    auto ast = new UnaryExpAST();
    ast->kind = UnaryExpAST::Kind::Unary;
    ast->op = std::unique_ptr<BaseAST>($1);
    ast->unaryExp = std::unique_ptr<BaseAST>($2);
    $$ = ast;
  }
  ;
```

这样，语法分析器就能根据匹配到的产生式，构造出对应的表达式节点。

### IR 生成

得到 AST 之后，下一步就是将它转换为 IR。按照之前的架构设计，我们先扩展用于表示 Koopa IR 的数据结构，再实现相应的打印和生成逻辑。

这里会遇到一个问题：Koopa IR 没有直接对应本节这些一元运算的专用运算指令，需要借助二元运算来表达它们。

Koopa IR 提供的二元运算主要包括以下几类：

- **比较运算**：`ne`（不等）、`eq`（相等）、`gt`（大于）、`lt`（小于）、`ge`（大于等于）、`le`（小于等于）。比较结果以整数表示，`0` 表示假，非 `0` 表示真。
- **算术运算**：`add`（加法）、`sub`（减法）、`mul`（乘法）、`div`（除法）、`mod`（取模）。
- **位运算**：`and`（按位与）、`or`（按位或）、`xor`（按位异或）。
- **移位运算**：`shl`（左移）、`shr`（逻辑右移）、`sar`（算术右移）。

本节需要的一元运算并不难转换：取负可以写成 `0 - x`，逻辑取反可以写成 `x == 0`，而一元 `+` 不改变操作数的值，直接沿用子表达式的结果即可。

类似地，按位取反也可以通过与全 `1` 的值，即 `-1`，进行异或来实现。不过，按位取反不在本小节新增的语法范围内，这里只是用它说明这种转换思路。

按照上述规则，示例程序可以生成下面的 Koopa IR：

```text
fun @main(): i32 {
%entry:
    %0 = eq 6, 0
    %1 = sub 0, %0
    %2 = sub 0, %1
    ret %2
}
```

其中，`eq 6, 0` 对应 `!6`，后面的两条 `sub` 分别对应两次取负。最外层的一元 `+` 不产生额外指令，因此直接返回 `%2`。

这里还需要注意临时结果的命名。`%0`、`%1`、`%2` 都是临时结果的名称，我们在实现中从 `0` 开始分配编号。Koopa IR 采用静态单赋值形式，同一个值名称只能定义一次，因此函数内的局部值和基本块需要使用互不冲突的名称。

**扩展 IR 数据结构**

观察上面的 IR，可以发现现有的 `ValueKind` 需要增加两种类型：表示临时结果引用的 `Temporary`，以及表示二元运算指令的 `Binary`。

首先是 `IRTemp`。与之前表示整数常量的 `IRInteger` 不同，它通过一个编号引用前面某条指令的计算结果：

```cpp
class IRTemp : public IRValue
{
public:
    int id;

    explicit IRTemp(int id)
        : IRValue(ValueKind::Temporary), id(id) {}
};
```

另一个新增类型是 `Binary`。它与之前实现的 `Return` 一样，属于指令：

```cpp
class Binary : public Instruction
{
public:
    int result_id;
    BinaryOp op;
    std::unique_ptr<IRValue> lhs;
    std::unique_ptr<IRValue> rhs;

    Binary(
        int result_id,
        BinaryOp op,
        std::unique_ptr<IRValue> lhs,
        std::unique_ptr<IRValue> rhs
    ) : Instruction(ValueKind::Binary),
        result_id(result_id),
        op(op),
        lhs(std::move(lhs)),
        rhs(std::move(rhs)) {}
};
```

一条 `Binary` 指令保存四部分信息：结果编号 `result_id`、运算符 `op`，以及左右两个操作数 `lhs` 和 `rhs`。其他指令需要使用它的结果时，只需构造一个编号相同的 `IRTemp`。

这里的 `Temporary` 和 `IRTemp` 是我们自定义 IR 结构中的设计，用来连接指令结果与后续使用。

**扩展 IR 打印**

数据结构确定后，先调整 `Printer`。本小节主要修改两个函数：`PrintInstruction` 和 `PrintOperand`。

`PrintInstruction` 需要增加对二元运算指令的支持。目前，一元表达式的转换只会用到 `eq` 和 `sub`，因此先处理这两种运算即可：

```cpp
case ValueKind::Binary:
{
    const auto& binary = static_cast<const Binary&>(inst);
    result = "%" + std::to_string(binary.result_id) + " = ";

    switch (binary.op)
    {
        case BinaryOp::Eq:
        {
            result += "eq ";
            break;
        }
        case BinaryOp::Sub:
        {
            result += "sub ";
            break;
        }
        default:
        {
            throw std::logic_error("invalid binary operation");
        }
    }

    result += PrintOperand(*binary.lhs) + ", " + PrintOperand(*binary.rhs);
    break;
}
```

`PrintOperand` 则需要识别临时结果，并将它打印为 `%编号` 的形式：

```cpp
case ValueKind::Temporary:
{
    const auto& temp = static_cast<const IRTemp&>(value);
    result = "%" + std::to_string(temp.id);
    break;
}
```

**从 AST 生成 IR**

接下来处理 AST 到 IR 的转换。

这里最重要的是区分两件事：**表达式的计算结果是什么，以及为了得到这个结果，需要生成哪些指令。**

因此，表达式生成函数一方面返回一个 `IRValue`，供外层表达式或 `return` 使用；另一方面，将计算过程中产生的指令追加到当前基本块的 `BasicBlock::insts` 中。

之前的 `GenerateNumber` 只负责构造整数常量，不需要生成指令，也不需要分配临时编号，所以只接收对应的 AST 节点即可。

现在的 `GenerateExp` 则不同。它可能需要向当前基本块追加计算指令，因此要接收 `BasicBlock& bb`；它还需要为指令结果分配编号，因此要接收一个共享的计数器 `int& next_id`。

由于临时编号需要在同一函数内保持唯一，`next_id` 应在 `GenerateFunction` 中初始化，再沿着生成过程逐层传递。调整后的接口如下：

```cpp
class IRGenerator
{
public:
    Program Generate(const CompUnitAST& ast) const;

private:
    std::unique_ptr<Function>
    GenerateFunction(const FuncDefAST& ast) const;

    void EmitBlock(
        const BlockAST& ast, BasicBlock& bb, int& next_id
    ) const;

    void EmitStmt(
        const StmtAST& ast, BasicBlock& bb, int& next_id
    ) const;

    std::unique_ptr<IRValue> GenerateExp(
        const ExpAST& ast, BasicBlock& bb, int& next_id
    ) const;

    std::unique_ptr<IRValue> GenerateUnaryExp(
        const UnaryExpAST& ast, BasicBlock& bb, int& next_id
    ) const;

    std::unique_ptr<IRValue> GenerateBinary(
        BinaryOp op,
        std::unique_ptr<IRValue> lhs,
        std::unique_ptr<IRValue> rhs,
        BasicBlock& bb,
        int& next_id
    ) const;

    std::unique_ptr<IRValue> GeneratePrimaryExp(
        const PrimaryExpAST& ast, BasicBlock& bb, int& next_id
    ) const;

    std::unique_ptr<IRValue>
    GenerateNumber(const NumberAST& ast) const;
};
```

除了在 `GenerateFunction` 中初始化计数器，以及在 `EmitBlock` 中传递新增参数，我们还需要修改 `EmitStmt`：原来的返回语句是 `return Number`，现在变成了 `return Exp`。

因此，生成 `Return` 指令之前，要先生成返回表达式所需的 IR，再将表达式的结果作为返回值：

```cpp
void IRGenerator::EmitStmt(
    const StmtAST& ast, BasicBlock& bb, int& next_id
) const
{
    const auto& exp = static_cast<const ExpAST&>(*ast.exp);
    auto value = GenerateExp(exp, bb, next_id);

    bb.insts.push_back(std::make_unique<Return>(std::move(value)));
}
```

接下来按照语法结构，递归实现 `GenerateExp` 和 `GenerateUnaryExp`：

```cpp
std::unique_ptr<IRValue> IRGenerator::GenerateExp(
    const ExpAST& ast, BasicBlock& bb, int& next_id
) const
{
    const auto& unary = static_cast<const UnaryExpAST&>(*ast.unaryExp);
    return GenerateUnaryExp(unary, bb, next_id);
}

std::unique_ptr<IRValue> IRGenerator::GenerateUnaryExp(
    const UnaryExpAST& ast, BasicBlock& bb, int& next_id
) const
{
    if (ast.kind == UnaryExpAST::Kind::PrimaryExp)
    {
        const auto& primary =
            static_cast<const PrimaryExpAST&>(*ast.primaryExp);
        return GeneratePrimaryExp(primary, bb, next_id);
    }

    const auto& op = static_cast<const UnaryOpAST&>(*ast.op);
    const auto& operand = static_cast<const UnaryExpAST&>(*ast.operand);
    auto rhs = GenerateUnaryExp(operand, bb, next_id);

    switch (op.kind)
    {
        case UnaryOpAST::Kind::Plus:
        {
            return rhs;
        }
        case UnaryOpAST::Kind::Minus:
        {
            return GenerateBinary(
                BinaryOp::Sub,
                std::make_unique<IRInteger>(0),
                std::move(rhs),
                bb,
                next_id
            );
        }
        case UnaryOpAST::Kind::Not:
        {
            return GenerateBinary(
                BinaryOp::Eq,
                std::move(rhs),
                std::make_unique<IRInteger>(0),
                bb,
                next_id
            );
        }
        default:
        {
            throw std::runtime_error("Invalid unary operator");
        }
    }
}
```

`UnaryExp` 有两种形式：`PrimaryExp` 和 `UnaryOp UnaryExp`。

对于第一种形式，继续递归处理 `PrimaryExp` 即可。它要么是一个整数，要么是一个括号表达式：整数交给 `GenerateNumber`，括号内的表达式则重新交给 `GenerateExp`。

```cpp
std::unique_ptr<IRValue> IRGenerator::GeneratePrimaryExp(
    const PrimaryExpAST& ast, BasicBlock& bb, int& next_id
) const
{
    if (ast.kind == PrimaryExpAST::Kind::Number)
    {
        const auto& number = static_cast<const NumberAST&>(*ast.number);
        return GenerateNumber(number);
    }
    else if (ast.kind == PrimaryExpAST::Kind::Expr)
    {
        const auto& expr = static_cast<const ExpAST&>(*ast.expr);
        return GenerateExp(expr, bb, next_id);
    }
    else
    {
        throw std::runtime_error("Invalid primary expression");
    }
}
```

对于第二种形式，先递归得到子表达式的结果，再根据一元运算符决定是否生成新的指令：一元 `+` 直接返回已有结果，`-` 和 `!` 则通过 `GenerateBinary` 生成对应的二元运算。

`GenerateBinary` 的职责也很明确：分配结果编号，将指令插入当前基本块，再返回对该结果的引用。

```cpp
std::unique_ptr<IRValue> IRGenerator::GenerateBinary(
    BinaryOp op,
    std::unique_ptr<IRValue> lhs,
    std::unique_ptr<IRValue> rhs,
    BasicBlock& bb,
    int& next_id
) const
{
    const int result_id = next_id++;

    bb.insts.push_back(
        std::make_unique<Binary>(
            result_id, op, std::move(lhs), std::move(rhs)
        )
    );

    return std::make_unique<IRTemp>(result_id);
}
```

这样，递归返回的是“表达式结果”，而计算过程已经按顺序保存在基本块中。到这里，一元表达式从 AST 到 Koopa IR 的生成和打印逻辑就串起来了。

### 代码生成

有了 IR 数据结构和对应的指令序列，接下来就可以生成 RISC-V 汇编了。

遍历方式与之前类似：依次访问函数、基本块和指令，再根据指令类型输出相应的汇编。与只处理常量返回值时相比，这一步新增的关键问题是：**IR 中的临时结果应该放在哪里，后续指令又如何找到它们？**

先看本小节生成的 Koopa IR：

```text
fun @main(): i32 {
%entry:
    %0 = eq 6, 0
    %1 = sub 0, %0
    %2 = sub 0, %1
    ret %2
}
```

我们希望将它转换为下面这样的 RISC-V 汇编：

```asm
  .text
  .globl main
main:
  # 实现 eq 6, 0，并将结果存入 t0
  li    t0, 6
  xor   t0, t0, x0
  seqz  t0, t0

  # 实现 sub 0, %0
  sub   t1, x0, t0

  # 实现 sub 0, %1
  sub   t2, x0, t1

  # 设置返回值并返回
  mv    a0, t2
  ret
```

这里，`%0`、`%1` 和 `%2` 分别对应寄存器 `t0`、`t1` 和 `t2`。只要维护好这层映射，后续指令就能找到前面计算得到的结果。

**临时结果与寄存器的对应关系**

在文本形式的 IR 中，`%1 = sub 0, %0` 通过 `%0` 引用前一条 `eq` 指令的结果。

在本文自定义的 IR 结构中，这种联系由编号建立：两条 `Binary` 指令按顺序保存在基本块的 `insts` 中，后一条指令的右操作数是一个 `IRTemp`，它的 `id` 与前一条指令的 `result_id` 相同。这里保存的是结果编号，而不是直接指向前一条指令的指针。

因此，生成汇编时，我们需要维护“临时结果编号 → 寄存器”的映射。

本节先选择 `t0`～`t6` 和 `a0`～`a7` 作为可分配的寄存器池。

另外，`x0` 是零寄存器，它的值恒为 `0`，因此常量 `0` 可以直接使用 `x0`，不需要额外加载。

为管理寄存器，我们引入 `RegisterContext`：

```cpp
struct RegisterContext
{
    std::unordered_map<int, std::string> temp_regs;

    std::vector<std::string> free_regs {
        "t0", "t1", "t2", "t3", "t4", "t5", "t6",
        "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"
    };

    std::string Allocate()
    {
        if (free_regs.empty())
        {
            throw std::runtime_error("no free registers available");
        }

        const auto reg = free_regs.front();
        free_regs.erase(free_regs.begin());
        return reg;
    }

    void Free(const std::string& reg)
    {
        free_regs.insert(free_regs.begin(), reg);
    }
};
```

其中，`temp_regs` 记录临时结果与寄存器的对应关系，`free_regs` 保存当前可以分配的寄存器。`Allocate` 从中取出一个寄存器，`Free` 则将用完的工作寄存器放回池中。

每生成一个函数，都应创建一个独立的 `RegisterContext`，避免不同函数之间的分配状态互相影响。随后，在访问基本块和指令时继续传递这个上下文：

```cpp
class CodeGen
{
public:
    std::string Generate(const Program& program) const;

private:
    void Visit(const Function& func, std::ostream& out) const;

    void Visit(
        const BasicBlock& block,
        const std::string& func_name,
        std::ostream& out,
        RegisterContext& ctx
    ) const;

    void Visit(
        const Instruction& inst,
        std::ostream& out,
        RegisterContext& ctx
    ) const;

    void Visit(
        const Return& ret,
        std::ostream& out,
        RegisterContext& ctx
    ) const;

    void Visit(
        const Binary& bin,
        std::ostream& out,
        RegisterContext& ctx
    ) const;

    std::string LoadOperand(
        const IRValue& value,
        const std::string& constant_reg,
        std::ostream& out,
        RegisterContext& ctx
    ) const;
};
```

你也许会注意到，如果按照一条指令的结果占用一个临时寄存器的目标代码生成思路，在表达式足够复杂的情况下，所有的临时寄存器很快就会被用完。但在本节中，我们先不要考虑这个问题。在 Exp Chapter 4 中，我们会实现一种一劳永逸的思路来解决这个问题。

**生成二元运算与返回指令**

此前的代码生成只需要处理 `Return` 指令和整数常量。现在需要补上两部分：一是根据 `IRTemp` 找到它对应的寄存器，二是为 `Binary` 指令生成汇编。

先看指令生成。返回值现在可能是临时结果，所以 `Return` 需要先通过 `LoadOperand` 获取操作数所在的寄存器，再将结果放入 `a0`：

```cpp
void CodeGen::Visit(
    const Return& ret, std::ostream& out, RegisterContext& ctx
) const
{
    const auto src = LoadOperand(*ret.operand, "a0", out, ctx);

    out << "  " << std::left << std::setw(5)
        << "mv" << "a0, " << src << "\n";
    out << "  ret\n";
}
```

对于 `Binary`，我们先为结果分配寄存器，再准备左右操作数，最后根据运算类型输出汇编：

```cpp
void CodeGen::Visit(
    const Binary& bin, std::ostream& out, RegisterContext& ctx
) const
{
    const auto dst = ctx.Allocate();
    ctx.temp_regs[bin.result_id] = dst;

    const auto lhs = LoadOperand(*bin.lhs, dst, out, ctx);

    auto rhs_reg = dst;
    if (lhs == dst && bin.rhs->kind == ValueKind::Integer &&
        static_cast<const IRInteger&>(*bin.rhs).value != 0)
    {
        rhs_reg = ctx.Allocate();
    }

    const auto rhs = LoadOperand(*bin.rhs, rhs_reg, out, ctx);

    switch (bin.op)
    {
        case BinaryOp::Eq:
        {
            out << "  " << std::left << std::setw(5)
                << "xor" << dst << ", " << lhs << ", " << rhs << "\n";
            out << "  " << std::left << std::setw(5)
                << "seqz" << dst << ", " << dst << "\n";
            break;
        }
        case BinaryOp::Sub:
        {
            out << "  " << std::left << std::setw(5)
                << "sub" << dst << ", " << lhs << ", " << rhs << "\n";
            break;
        }
        default:
        {
            throw std::runtime_error(
                "unsupported binary operator: " +
                std::to_string(static_cast<int>(bin.op))
            );
        }
    }

    if (rhs_reg != dst)
    {
        ctx.Free(rhs_reg);
    }
}
```

其中，Koopa IR 的 `eq` 在这里通过 `xor` 和 `seqz` 实现：两个操作数相等时，异或结果为 `0`；随后，`seqz` 判断这个结果是否为 `0`，并生成相应的布尔结果。

这样，一条 IR 指令就被展开成了两条汇编指令。

再看寄存器分配。这里没有让 `LoadOperand` 自行申请寄存器，而是在 `Visit(Binary)` 中统一安排，是因为调用方能够同时看到左右操作数和结果，更容易判断哪些寄存器可以在当前指令内复用。

在当前方案中，结果寄存器 `dst` 始终通过 `Allocate` 新申请。

操作数则分情况处理：如果是临时结果，直接查找已有映射；如果是常量 `0`，直接使用 `x0`；如果是非零常量，则需要先将它加载到某个寄存器中。

这时，新申请的 `dst` 尚未保存计算结果，可以先用来加载一个非零常量，从而减少一次寄存器申请。

只有当左右操作数都是非零常量时，才需要为另一个操作数额外申请工作寄存器，避免后一次加载覆盖前一次加载的值。

这个额外的工作寄存器只服务于当前指令，运算结束后即可释放。

结果寄存器则需要保留，供后续指令通过 `temp_regs` 查找。

**加载操作数**

最后实现 `LoadOperand`。

与之前不同，这个函数不再只负责输出加载指令，而是返回操作数所在的寄存器名称。因此，它的返回类型从 `void` 改成了 `std::string`。

参数 `constant_reg` 表示：当操作数是非零常量时，由调用方指定将它加载到哪个寄存器。对于常量 `0` 和已经存在的临时结果，这个参数不会被使用。

```cpp
std::string CodeGen::LoadOperand(
    const IRValue& value,
    const std::string& constant_reg,
    std::ostream& out,
    RegisterContext& ctx
) const
{
    switch (value.kind)
    {
        case ValueKind::Integer:
        {
            const auto& integer = static_cast<const IRInteger&>(value);
            if (integer.value == 0)
            {
                return "x0";
            }

            out << "  " << std::left << std::setw(5)
                << "li" << constant_reg << ", " << integer.value << "\n";
            return constant_reg;
        }
        case ValueKind::Temporary:
        {
            const auto& temp = static_cast<const IRTemp&>(value);
            return ctx.temp_regs.at(temp.id);
        }
        default:
        {
            throw std::runtime_error(
                "unsupported value kind: " +
                std::to_string(static_cast<int>(value.kind))
            );
        }
    }
}
```

至此，操作数的处理也统一起来了：非零常量通过 `li` 加载，零常量直接使用 `x0`，临时结果通过编号查找对应寄存器。上层的指令生成函数拿到寄存器名称后，就可以继续输出相应的汇编。

代码中的 `std::left` 和 `std::setw` 只用于对齐输出，让生成的汇编更便于阅读，不影响指令语义。

## 算术表达式

本节中，我们将继续扩展表达式的语法，使编译器支持加、减、乘、除和取余运算。新增或变更的语法规则如下：

```text
Exp         ::= AddExp;
PrimaryExp  ::= ...;
Number      ::= ...;
UnaryExp    ::= ...;
UnaryOp     ::= ...;
MulExp      ::= UnaryExp | MulExp ("*" | "/" | "%") UnaryExp;
AddExp      ::= MulExp | AddExp ("+" | "-") MulExp;
```

本节需要处理的示例程序如下：

```c
int main()
{
    return 1 + 2 * 3;
}
```

### 词法分析与语法分析

词法分析部分仍然沿用之前的实现。本节新增的运算符 `*`、`/` 和 `%` 都是单字符运算符，可以由已有的单字符匹配规则处理，因此不需要在 Flex 中为它们添加额外的规则。

本节的重点在于语法分析：我们需要根据新增和变更的语法规则，补充或调整对应的 AST 节点。

首先，我们用枚举类型表示一元和二元运算符，并定义两个重载的辅助函数 `DumpOp`，用于输出对应的运算符。这样，在实现 AST 节点的 `Dump()` 时，就不需要重复编写运算符的输出逻辑了。

```cpp
enum class BinaryOpKind { Plus, Minus, Star, Div, Mod };
enum class UnaryOpKind { Plus, Minus, Not };

inline void DumpOp(BinaryOpKind op)
{
    switch (op)
    {
        case BinaryOpKind::Plus:  std::cout << "+"; return;
        case BinaryOpKind::Minus: std::cout << "-"; return;
        case BinaryOpKind::Star:  std::cout << "*"; return;
        case BinaryOpKind::Div:   std::cout << "/"; return;
        case BinaryOpKind::Mod:   std::cout << "%"; return;
    }
    throw std::runtime_error("Invalid binary operator kind");
}

inline void DumpOp(UnaryOpKind op)
{
    switch (op)
    {
        case UnaryOpKind::Plus:  std::cout << "+"; return;
        case UnaryOpKind::Minus: std::cout << "-"; return;
        case UnaryOpKind::Not:   std::cout << "!"; return;
    }
    throw std::runtime_error("Invalid unary operator kind");
}
```

接下来，根据语法规则定义相应的 AST 节点。以 `AddExpAST` 为例，`AddExp` 有两种形式：一种只包含一个 `MulExp`，另一种则由 `AddExp`、加减运算符和 `MulExp` 组成。我们继续使用 `Kind` 枚举区分这两种情况：

```cpp
class AddExpAST : public BaseAST
{
public:
    std::unique_ptr<BaseAST> MulExp;
    BinaryOpKind BinaryOp;
    std::unique_ptr<BaseAST> AddExp;

    enum class Kind { MulExp, AddExp };
    Kind kind;

    void Dump() const override
    {
        std::cout << "AddExpAST { ";
        switch (kind)
        {
            case Kind::MulExp:
            {
                MulExp->Dump();
                break;
            }
            case Kind::AddExp:
            {
                AddExp->Dump();
                DumpOp(BinaryOp);
                MulExp->Dump();
                break;
            }
        }
        std::cout << " }";
    }
};
```

定义好 AST 节点后，我们还需要在 Bison 文件中补充对应的产生式和语法动作。

先来看下面这条规则：

```text
AddExp ::= AddExp ("+" | "-") MulExp;
```

一种直接的写法是将它拆成两条产生式，分别处理 `+` 和 `-`。不过，这两种情况的结构相同，区别只在于运算符。为了减少重复，也方便后续扩展，我们可以将运算符提取为一个单独的非终结符 `AddOp`：

```text
AddExp ::= AddExp AddOp MulExp;
AddOp  ::= "+" | "-";
```

同理，`MulExp` 中的 `*`、`/` 和 `%` 也可以提取为非终结符 `MulOp`。

相应地，我们需要在 `%union` 中加入保存运算符枚举值的成员，并通过 `%type` 声明各个非终结符的语义值类型。其中，表达式节点使用 `ast_val`，`UnaryOp` 使用 `unary_op_val`，而 `AddOp` 和 `MulOp` 则共用 `binary_op_val`：

```text
%union {
  std::string *str_val;
  int int_val;
  BaseAST *ast_val;
  UnaryOpKind unary_op_val;
  BinaryOpKind binary_op_val;
}

%type <ast_val> FuncDef FuncType Block Stmt Number Exp UnaryExp PrimaryExp AddExp MulExp
%type <unary_op_val> UnaryOp
%type <binary_op_val> AddOp MulOp
```

接着，为这些运算符非终结符编写产生式，在语法动作中返回对应的枚举值：

```text
UnaryOp
  : '+' { $$ = UnaryOpKind::Plus; }
  | '-' { $$ = UnaryOpKind::Minus; }
  | '!' { $$ = UnaryOpKind::Not; }
  ;

AddOp
  : '+' { $$ = BinaryOpKind::Plus; }
  | '-' { $$ = BinaryOpKind::Minus; }
  ;

MulOp
  : '*' { $$ = BinaryOpKind::Star; }
  | '/' { $$ = BinaryOpKind::Div; }
  | '%' { $$ = BinaryOpKind::Mod; }
  ;
```

其余表达式的处理方式与之前相同：根据各自的产生式编写语法动作，将子表达式和运算符保存到对应的 AST 节点中，再通过 `$$` 返回构造好的节点即可。

至此，本节的词法分析与语法分析部分就完成啦！

### IR 生成

得到 AST 后，就可以开始生成 IR 了。我们依旧沿用之前的实现顺序：先扩展用于表示 Koopa IR 的数据结构，再补充对应的转换和打印逻辑。

对于上一节中的示例 `return 1 + 2 * 3;`，我们希望生成如下 Koopa IR：

```text
fun @main(): i32 {
%entry:
    %0 = mul 2, 3
    %1 = add 1, %0
    ret %1
}
```

我们知道，`*`、`/` 和 `%` 的优先级高于 `+` 和 `-`。因此，在这个例子中，应该先计算 `2 * 3`，再将结果与 `1` 相加。

好在 SysY 的语法规则已经通过 `AddExp` 和 `MulExp` 的层次关系体现了运算符的优先级。只要正确构建 AST，后续按照 AST 的结构，先递归生成子表达式的 IR，再生成当前运算的指令，就能得到上面的结果，**不需要在 IR 生成阶段重新判断运算符的优先级**。

另一个方便的地方是，在实现一元表达式时，我们已经引入了二元运算指令。因此，本节不需要重新设计指令结构，只需扩展支持的运算种类即可。在实现上，就是为 `BinaryOp` 枚举补充相应的成员：

```cpp
enum class BinaryOp
{
    Sub,
    Eq,
    Add,
    Mul,
    Div,
    Mod,
};
```

相应地，我们还需要在 `Printer` 的 `PrintInstruction` 中补齐这些新增运算的打印逻辑。

最后来看 `IRGenerator`。这部分的实现方式与之前处理 `UnaryExp` 时类似：递归生成子表达式的 IR，再根据运算符调用 `GenerateBinary`，生成当前运算的指令。

以 `GenerateAddExp` 为例：当 `AddExp` 只包含一个 `MulExp` 时，直接返回 `GenerateMulExp` 的结果即可；否则，先分别处理左侧的 `AddExp` 和右侧的 `MulExp`，得到两个操作数，再生成对应的加法或减法指令。

```cpp
std::unique_ptr<IRValue> IRGenerator::GenerateAddExp(
    const AddExpAST& ast,
    BasicBlock& bb,
    int& next_id
) const
{
    const auto& mulExp = static_cast<MulExpAST&>(*ast.MulExp);

    if (ast.kind == AddExpAST::Kind::MulExp)
    {
        return GenerateMulExp(mulExp, bb, next_id);
    }

    const auto& addExp = static_cast<AddExpAST&>(*ast.AddExp);
    auto lhs = GenerateAddExp(addExp, bb, next_id);
    auto rhs = GenerateMulExp(mulExp, bb, next_id);

    switch (ast.BinaryOp)
    {
        case BinaryOpKind::Plus:
        {
            return GenerateBinary(
                BinaryOp::Add,
                std::move(lhs),
                std::move(rhs),
                bb, next_id
            );
        }
        case BinaryOpKind::Minus:
        {
            return GenerateBinary(
                BinaryOp::Sub,
                std::move(lhs),
                std::move(rhs),
                bb, next_id
            );
        }
        default:
        {
            throw std::runtime_error("Invalid binary operator");
        }
    }
}
```

`GenerateMulExp` 的实现思路相同，只需按照对应的语法结构递归处理子表达式，并生成乘法、除法或取余指令即可。

至此，我们就完成了本节从 AST 到 IR 的转换。

### 代码生成

最后，我们来看代码生成部分。对于上一节中的表达式 `1 + 2 * 3`，其计算过程可以用下面这段 RISC-V 汇编表示：

```asm
  li   t0, 2
  li   t1, 3
  mul  t1, t0, t1
  li   t2, 1
  add  t2, t1, t2
```

这部分的实现比较直接。由于我们已经支持了二元运算指令的代码生成，现在只需在已有逻辑中，补齐新增运算对应的汇编指令即可。

例如，对于取余运算，我们在处理 `BinaryOp::Mod` 的分支中输出一条 `rem` 指令：

```cpp
// ...
case BinaryOp::Mod:
{
    out << "  " << std::left << std::setw(5) << "rem"
        << dst << ", " << lhs << ", " << rhs << "\n";
    break;
}
// ...
```

其他新增运算也按照相同的方式处理即可。

不过，由于我们的实现采用了寄存器复用，实际生成的汇编在寄存器分配上会与前面的示例略有不同。完整输出如下：

```asm
  .text
  .globl main
main:
  li   t0, 2
  li   t1, 3
  mul  t0, t0, t1
  li   t1, 1
  add  t1, t1, t0
  mv   a0, t1
  ret
```

可以看到，乘法指令将 `2 * 3` 的结果写入了 `t0`，而原先保存常量 `3` 的 `t1` 随后被复用，用于加载常量 `1`，并保存加法的结果。最后，将计算结果放入 `a0` 并返回。

虽然两段代码使用的寄存器不同，但都完成了相同的计算：先计算 `2 * 3`，再将结果与 `1` 相加。因此，**寄存器分配上的差异并不影响这个例子的计算结果**。

至此，我们就完成了本节算术表达式的代码生成。

## 比较和逻辑表达式

本节中，我们将继续扩展表达式的语法，使编译器支持比较运算和逻辑运算。新增或变更的语法规则如下：

```text
Exp         ::= LOrExp;
PrimaryExp  ::= ...;
Number      ::= ...;
UnaryExp    ::= ...;
UnaryOp     ::= ...;
MulExp      ::= ...;
AddExp      ::= ...;
RelExp      ::= AddExp | RelExp ("<" | ">" | "<=" | ">=") AddExp;
EqExp       ::= RelExp | EqExp ("==" | "!=") RelExp;
LAndExp     ::= EqExp | LAndExp "&&" EqExp;
LOrExp      ::= LAndExp | LOrExp "||" LAndExp;
```

本节需要处理的示例程序如下：

```c
int main()
{
    return 1 <= 2;
}
```

### 词法分析与语法分析

与上一节不同，本节除了需要扩展语法分析，还需要对词法分析做一些调整。

这是因为新增的运算符中出现了 `<=`、`>=` 等双字符运算符。它们不能再仅靠之前的单字符匹配规则处理，因此我们需要在 Lexer 中补充对应的规则，将每个双字符运算符识别为一个完整的 Token：

```text
"<="            { return LE; }
">="            { return GE; }
"=="            { return EQ; }
"!="            { return NE; }
"&&"            { return LAND; }
"||"            { return LOR; }
```

相应地，还需要在 Bison 文件中声明这些 Token：

```text
%token LE GE EQ NE LAND LOR
```

接下来，就可以根据新增的语法规则，补充对应的 AST 节点、产生式和语法动作了。这部分的实现方式与上一节相同，这里就不再逐一展开。

### IR 生成

对于示例中的 `return 1 <= 2;`，我们希望生成如下 Koopa IR：

```text
fun @main(): i32 {
%entry:
    %0 = le 1, 2
    ret %0
}
```

整体实现思路与算术表达式基本相同。在数据结构上，我们仍然沿用已有的二元运算指令，只需在 `BinaryOp` 枚举中补充相应的运算种类：

```cpp
enum class BinaryOp
{
    Sub,
    Eq,
    Add,
    Mul,
    Div,
    Mod,
    LOr,
    LAnd,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
};
```

`Printer` 的修改也比较直接：在 `PrintInstruction` 的 `Binary` 分支中，补齐新增运算的打印逻辑即可。

不过，在实现 AST 到 IR 的转换时，逻辑运算需要单独处理。**Koopa IR 提供的是按位与 `and` 和按位或 `or`，并没有直接对应逻辑与 `&&` 和逻辑或 `||` 的二元运算指令。** 因此，我们需要将比较运算和位运算组合起来，得到逻辑运算的结果。这里的 `LAnd` 和 `LOr` 只是我们在枚举中的命名，实际对应的仍然是 Koopa IR 的 `and` 和 `or`。

对于逻辑与 `a && b`，我们可以先将两个操作数分别转换为 `0` 或 `1`，再进行按位与：

```text
%a_bool = ne %a, 0
%b_bool = ne %b, 0
%result = and %a_bool, %b_bool
```

其中，`ne x, 0` 的作用是判断 `x` 是否非零：当 `x` 为 `0` 时，结果为 `0`；否则，结果为 `1`。这样，只有两个操作数都非零时，最终的按位与结果才会是 `1`。

对于逻辑或 `a || b`，则可以先进行按位或，再判断结果是否非零：

```text
%bit = or %a, %b
%result = ne %bit, 0
```

这是因为，**两个整数按位或的结果为零，当且仅当它们都为零**。因此，只要其中一个操作数非零，`%bit` 就一定非零，再通过 `ne %bit, 0`，就能将结果统一为 `0` 或 `1`。

明确了这些转换关系后，就可以在 IR 生成器中实现对应的逻辑了。以 `GenerateLAndExp` 为例：如果当前节点只包含一个 `EqExp`，直接返回它的生成结果；否则，先递归处理左右两侧的子表达式，再分别将它们转换为布尔值，最后生成一条 `and` 指令。

```cpp
std::unique_ptr<IRValue> IRGenerator::GenerateLAndExp(
    const LAndExpAST& ast,
    BasicBlock& bb,
    int& next_id
) const
{
    const auto& EqExp = static_cast<EqExpAST&>(*ast.EqExp);

    if (ast.kind == LAndExpAST::Kind::EqExp)
    {
        return GenerateEqExp(EqExp, bb, next_id);
    }

    const auto& LAndExp = static_cast<LAndExpAST&>(*ast.LAndExp);

    auto lhs = GenerateLAndExp(LAndExp, bb, next_id);
    auto rhs = GenerateEqExp(EqExp, bb, next_id);

    auto lhs_bool = GenerateBinary(
        BinaryOp::Ne,
        std::move(lhs),
        std::make_unique<IRInteger>(0),
        bb, next_id
    );

    auto rhs_bool = GenerateBinary(
        BinaryOp::Ne,
        std::move(rhs),
        std::make_unique<IRInteger>(0),
        bb, next_id
    );

    return GenerateBinary(
        BinaryOp::LAnd,
        std::move(lhs_bool),
        std::move(rhs_bool),
        bb, next_id
    );
}
```

`GenerateLOrExp` 的实现方式类似，只需按照前面给出的转换关系，先生成按位或指令，再将结果与 `0` 比较即可。

至此，我们就完成了本节所需的 IR 生成与输出。

### 代码生成

最后，我们来看代码生成部分。对于示例中的 `1 <= 2`，其计算过程可以用下面这段 RISC-V 汇编表示：

```asm
  li    t0, 1
  li    t1, 2
  # 判断 t0 是否小于等于 t1
  sgt   t1, t0, t1
  seqz  t1, t1
```

这里先通过 `sgt` 判断 `t0` 是否大于 `t1`，再通过 `seqz` 判断前一步的结果是否为零。换句话说，就是利用“`a <= b` 等价于 `!(a > b)`”来完成比较。

不过，并不是每一条 Koopa IR 运算指令，都能直接对应到一条 RISC-V 基础指令。例如，我们之前实现的 `eq`，以及本节新增的部分比较运算，都需要通过其他指令组合实现。

这里还需要区分基础指令和伪指令。上面使用的 `sgt` 是一条伪指令，汇编器会将它转换为交换两个源操作数后的 `slt`；`seqz` 和 `snez` 也都是伪指令，分别用于判断操作数是否为零、是否非零。

在实现这类转换时，我们可以借助 Compiler Explorer（Godbolt），观察 Clang 如何将相应的表达式编译为 RISC-V 汇编。原稿使用的是 `RISC-V rv32gc clang (trunk)`，编译选项为 `-O3 -g0`；实际操作时，选择网站当前提供的对应编译器即可。这里观察的是 Clang 的汇编输出，Koopa IR 则仍由我们自己的编译器生成。

当然，也可以借助 AI 查找相关指令和转换思路，再对照规范确认其含义，而不是直接照搬生成的代码。

对于本节涉及的运算，我们采用下面这些指令序列。其中，大小比较使用有符号比较指令 `slt`；需要对比较结果取反时，可以利用结果只会是 `0` 或 `1` 的特点，与 `1` 进行异或。

| IR 运算枚举 | Koopa 指令 | RISC-V 指令序列 |
| --- | --- | --- |
| `Eq` | `eq` | `xor dst, lhs, rhs`，再执行 `seqz dst, dst` |
| `Ne` | `ne` | `xor dst, lhs, rhs`，再执行 `snez dst, dst` |
| `Lt` | `lt` | `slt dst, lhs, rhs` |
| `Gt` | `gt` | `slt dst, rhs, lhs` |
| `Le` | `le` | `slt dst, rhs, lhs`，再执行 `xori dst, dst, 1` |
| `Ge` | `ge` | `slt dst, lhs, rhs`，再执行 `xori dst, dst, 1` |
| `LAnd` | `and` | `and dst, lhs, rhs` |
| `LOr` | `or` | `or dst, lhs, rhs` |

注意，表中的 `LAnd` 和 `LOr` 对应的是 IR 层面的按位运算。逻辑结果所需的布尔转换，已经在 AST 到 IR 的阶段完成，代码生成阶段只需处理这些已经拆分好的指令。

除此之外，我们还可以从汇编中观察到一个值得利用的小优化。

先来看逻辑或：

```text
a || b
```

按照本节的非短路转换方式，在得到 `a` 和 `b` 的值后，我们会生成如下 Koopa IR：

```text
%bit = or %a, %b
%out = ne %bit, 0
```

假设两个操作数分别位于 `a0` 和 `a1`，对应的计算可以用下面两条汇编指令完成：

```asm
  or    a0, a0, a1
  snez  a0, a0
```

再来看不等比较：

```text
a != b
```

它对应的 Koopa IR 是：

```text
%out = ne %a, %b
```

对于两个一般的操作数，我们采用的汇编序列则是：

```asm
  xor   a0, a0, a1
  snez  a0, a0
```

对比可以发现，两处 `ne` 的处理方式并不完全相同：前者只需要一条 `snez`，后者则需要先执行 `xor`。

原因在于，与 `0` 进行不等比较，本质上就是判断另一个操作数是否非零，因此可以直接使用 `snez`，不必再执行一次异或。同理，与 `0` 进行相等比较时，也可以直接使用 `seqz`。

在我们的实现中，当某个操作数已经被表示为零寄存器 `x0` 时，就可以利用这一点，省去不必要的 `xor`：

```cpp
case BinaryOp::Ne:
{
    if (rhs == "x0")
    {
        EMIT2(out, "snez", dst, lhs);
    }
    else if (lhs == "x0")
    {
        EMIT2(out, "snez", dst, rhs);
    }
    else
    {
        EMIT3(out, "xor", dst, lhs, rhs);
        EMIT2(out, "snez", dst, dst);
    }
    break;
}
```

`Eq` 分支也可以采用相同的处理方式，只需将 `snez` 换成 `seqz` 即可。

上面的代码使用了 `EMIT2` 和 `EMIT3` 两个宏，分别输出包含两个、三个操作数的汇编指令。它们只是对之前重复的输出语句做了一层封装，让各个运算分支更容易阅读：

```cpp
#define EMIT2(OUT, OP, A, B)                                      \
    do                                                           \
    {                                                            \
        (OUT) << "  " << std::left << std::setw(5) << (OP)         \
              << (A) << ", " << (B) << "\n";                     \
    } while (0)

#define EMIT3(OUT, OP, A, B, C)                                   \
    do                                                           \
    {                                                            \
        (OUT) << "  " << std::left << std::setw(5) << (OP)         \
              << (A) << ", " << (B) << ", " << (C) << "\n";       \
    } while (0)
```

这样，我们就完成了比较表达式，以及逻辑表达式非短路版本的代码生成。加上前几节的内容，从表达式解析、AST 构建，到 IR 生成和目标代码生成，整个流程就串起来啦！
