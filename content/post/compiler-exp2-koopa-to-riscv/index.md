---
title: "[从零开始的编译原理][实验] Exp Chapter 2：从 Koopa IR 到 RISC-V"
date: 2026-10-06T20:24:45+08:00
slug: compiler-exp2-koopa-to-riscv
series:
    - 技术分享
categories:
    - 编译原理
column:
    - 编译原理
tags:
    - 编译原理
    - 编译器实验
    - RISC-V
    - Koopa IR
    - 代码生成
seriesOrder: 5
math: true
comments: false
---

接下来，在本节中，我们将在上一节工作的基础上，让编译器进一步支持生成 **RISC-V 汇编代码**。

目前我们需要编译的 SysY 程序仍然非常简单：

```c
int main()
{
    // 摊牌了，我是注释
    return 0;
}
```

上一节中，我们已经可以将它编译为如下的 Koopa IR：

```text
fun @main(): i32 {
%entry:
  ret 0
}
```

而本节的目标，是继续完成从 Koopa IR 到 RISC-V 汇编的转换。例如生成：

```asm
  .text
  .globl main
main:
  li a0, 0
  ret
```

当然，根据具体的代码生成策略，也可能生成：

```asm
  .text
  .globl main
main:
  li t0, 0
  mv a0, t0
  ret
```

两种写法在这里的效果是一样的：最终都将整数 `0` 放入返回值寄存器 `a0` 中，然后从 `main` 函数返回。

具体生成哪一种形式，取决于我们的代码生成器如何处理中间结果和寄存器。对于当前这个非常简单的程序来说，显然没有必要额外使用临时寄存器，因此我们直接生成第一种形式即可。

## 目标代码生成

目前，我们的编译器已经完成了这样一条编译链：

```text
SysY 源代码
    ↓
Lexer / Parser
    ↓
AST
    ↓
Koopa IR
```

接下来需要继续完成：

```text
Koopa IR
    ↓
CodeGen
    ↓
RISC-V Assembly
```

上一章中，我们已经自己设计并实现了 Koopa IR 的数据结构。因此，这里的目标代码生成与之前实现 `Printer` 输出 Koopa IR 文本其实非常类似：

> **遍历 IR 数据结构，根据不同的 IR 节点输出对应的 RISC-V 指令。**

例如：

```text
ret 0
```

对应：

```asm
li a0, 0
ret
```

因此，从整体结构来看，`CodeGen` 同样可以采用 Visitor 风格的实现：依次访问 `Program`、`Function`、`BasicBlock` 和 `Instruction`，最终将每条 IR 指令翻译成对应的汇编指令。

不过，在开始实现之前，我们首先需要理解生成出来的这几行 RISC-V 汇编究竟在做什么。

对于：

```asm
  .text
  .globl main
main:
  li a0, 0
  ret
```

整体上主要完成了三件事情：

1. 定义函数 `main` 的入口；
2. 将函数返回值 `0` 放入规定的返回值寄存器；
3. 执行函数返回。

因此，我们首先需要回答三个问题。

1. **如何定义一个函数？**

在高级语言中，我们习惯把函数理解成：

```c
int main()
{
    return 0;
}
```

但从处理器的视角来看，函数本质上只是一段**连续或逻辑关联的指令序列**。

调用函数时，处理器跳转到这段指令序列的入口开始执行；函数执行结束时，再通过返回指令跳回调用者。

因此，在汇编层面，并不存在类似 C/C++ 中：

```text
int main()
```

这样的“函数定义语法”。

我们真正需要做的，只是给这段指令的入口位置定义一个符号：

```text
main:
```

这里的 `main` 是一个 **label（标签）**。汇编器会把它关联到当前位置对应的地址。之后，无论是链接器还是其他代码，都可以通过符号 `main` 找到这段代码的入口。

同时：

```asm
.globl main
```

用于声明 `main` 是一个全局符号，使这个符号可以被链接器看到。

而：

```asm
.text
```

则表示接下来的内容属于 `.text` 段，也就是程序的代码段。

因此：

```asm
  .text
  .globl main
main:
```

可以简单理解成：

> 接下来是一段代码，并且我们定义了一个可以被外部找到的函数入口 `main`。

至于函数如何返回，并不是函数标签本身负责的，而是函数内部生成的指令负责的。

2. **如何在 RISC-V 中设置返回值？**

函数调用不仅涉及“跳转到哪里”，还涉及调用者和被调用者之间如何传递参数、返回值，以及哪些寄存器需要保存等问题。

这些规则由 <strong>RISC-V Calling Convention（调用约定）</strong>规定。

对于整数返回值，RISC-V 使用：

```text
a0
a1
```

作为返回值寄存器。

在 RV32 中，一个通用寄存器的宽度为 32 bit，因此 `a0` 和 `a1` 可以用于传递最多两个 XLEN 宽度的整数返回值。

不过对于我们现在的程序：

```c
int main()
{
    return 0;
}
```

只有一个 `int` 类型返回值，因此只需要：

```text
a0
```

也就是说：

```text
return 0;
```

最终需要确保：

```text
a0 = 0
```

随后再执行函数返回即可。

3. **如何将整数加载到寄存器中？**

接下来的问题就是：如何让：

```text
a0 = 0
```

RISC-V 汇编器提供了一个非常方便的伪指令：

```asm
li rd, imm
```

其中：

- `rd` 表示目标寄存器；
- `imm` 表示立即数。

例如：

```asm
li a0, 0
```

表示：

> 将立即数 `0` 加载到寄存器 `a0` 中。

需要注意的是，`li` 是一个**伪指令（pseudo-instruction）**，它并不一定直接对应某一条真实的 RISC-V 机器指令。

汇编器会根据立即数的大小，将它展开为一条或多条真正的 RISC-V 指令。例如对于较小的立即数：

```asm
li a0, 0
```

可以被展开成类似：

```asm
addi a0, zero, 0
```

至于具体如何展开，则交给汇编器处理即可。对于编译器前端和目前的简单代码生成器而言，我们直接生成 `li` 会方便很多。

函数最后的：

```asm
ret
```

同样也是一个伪指令。

它表示：

> 从当前函数返回到调用者。

其底层实际上可以展开为类似：

```asm
jalr zero, 0(ra)
```

其中 `ra` 保存了函数调用完成后应该返回的位置。

因此，我们生成：

```asm
  .text
  .globl main
main:
  li a0, 0
  ret
```

其含义可以完整地理解为：

```asm
  .text         # 接下来的内容放入代码段
  .globl main   # 将 main 声明为全局符号

main:           # main 函数的入口
  li a0, 0      # 将返回值 0 放入 a0
  ret           # 返回调用者
```

这就完成了：

```c
int main()
{
    return 0;
}
```

最基本的目标代码生成。

---

接下来，我们就可以仿照上一节 `Printer` 的实现方式，设计一个 `CodeGen` 类：

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
        std::ostream& out
    ) const;

    void Visit(const Instruction& inst, std::ostream& out) const;
    void Visit(const Return& ret, std::ostream& out) const;

    void LoadOperand(
        const IRValue& value,
        const char* reg,
        std::ostream& out
    ) const;
};
```

它的整体结构和 `Printer` 非常相似。

我们仍然按照：

```text
Program
   ↓
Function
   ↓
BasicBlock
   ↓
Instruction
```

这样的层次遍历 IR。

区别在于，之前的 `Printer` 只是把 IR 数据结构重新打印为 Koopa IR 文本，例如：

```text
ret 0
```

而现在的 `CodeGen` 需要真正考虑目标机器的语义。

例如面对：

```text
ret 0
```

我们不能简单地输出：

```text
ret 0
```

而需要知道 RISC-V 的调用约定规定返回值应当放在 `a0` 中，因此要生成：

```asm
li a0, 0
ret
```

也就是说：

> `Printer` 主要关心 IR 的语法，而 `CodeGen` 开始需要关心目标架构的 ABI、寄存器和指令。

因此，我们额外定义：

```text
LoadOperand(...)
```

负责将一个 IR 操作数加载到指定寄存器。

目前我们的 IR 非常简单，操作数只有整数立即数，因此 `LoadOperand` 暂时只需要处理：

```text
IRInteger
```

未来随着 IR 中出现临时变量、二元表达式、局部变量等内容，这个函数才会逐渐涉及寄存器和栈上的数据。

具体实现如下：

```cpp
std::string CodeGen::Generate(const Program& program) const
{
    std::ostringstream out;

    out << "  .text\n";

    for (const auto& func : program.funcs)
    {
        Visit(*func, out);
    }

    return out.str();
}
```

`Generate` 是整个目标代码生成过程的入口。

首先：

```cpp
out << "  .text\n";
```

声明接下来生成的是代码段。

然后依次遍历程序中的所有函数：

```cpp
for (const auto& func : program.funcs)
{
    Visit(*func, out);
}
```

虽然目前我们的程序中只有一个：

```text
main
```

但是从数据结构和代码生成器的设计上，我们仍然按照“一个程序可以包含多个函数”的方式实现。

接下来处理函数：

```cpp
void CodeGen::Visit(const Function& func, std::ostream& out) const
{
    out << "  .globl " << func.name << "\n";
    out << func.name << ":\n";

    for (const auto& block : func.bbs)
    {
        Visit(*block, func.name, out);
    }

    out << "\n";
}
```

对于每个函数，首先生成：

```asm
.globl main
main:
```

分别对应：

```cpp
out << "  .globl " << func.name << "\n";
out << func.name << ":\n";
```

随后遍历函数中的所有基本块：

```cpp
for (const auto& block : func.bbs)
{
    Visit(*block, func.name, out);
}
```

目前我们的 `main` 只有一个基本块：

```text
%entry
```

并且不存在跳转，因此还不需要真的为 `%entry` 生成汇编标签。

后面当程序出现：

```text
if
while
```

等控制流结构时，一个函数中会出现多个基本块。此时我们就需要为不同的基本块生成标签，例如：

```text
main_entry:
main_then:
main_else:
main_end:
```

这里将 `func.name` 一并传给 `Visit(BasicBlock)`，也正是为了给后续生成基本块标签预留上下文。

目前基本块本身只需要继续遍历其中的指令：

```cpp
void CodeGen::Visit(
    const BasicBlock& bb,
    const std::string& func_name,
    std::ostream& out
) const
{
    for (const auto& inst : bb.insts)
    {
        Visit(*inst, out);
    }
}
```

接下来根据指令类型进行分派：

```cpp
void CodeGen::Visit(const Instruction& inst, std::ostream& out) const
{
    switch (inst.kind)
    {
        case ValueKind::Return:
        {
            Visit(static_cast<const Return&>(inst), out);
            return;
        }

        default:
        {
            throw std::runtime_error(
                "unsupported instruction kind: " +
                std::to_string(static_cast<int>(inst.kind))
            );
        }
    }
}
```

目前我们的 IR 中唯一可能出现的指令就是：

```text
Return
```

因此只需要处理：

```text
ValueKind::Return
```

即可。

对于：

```text
ret 0
```

对应的 IR 大致可以理解为：

```text
Return
└── operand
    └── Integer(0)
```

因此在处理 `Return` 时：

```cpp
void CodeGen::Visit(const Return& ret, std::ostream& out) const
{
    LoadOperand(*ret.operand, "a0", out);
    out << "  ret\n";
}
```

我们首先调用：

```cpp
LoadOperand(*ret.operand, "a0", out);
```

含义就是：

> 将 `return` 的操作数加载到返回值寄存器 `a0`。

随后：

```cpp
out << "  ret\n";
```

生成函数返回指令。

最后实现 `LoadOperand`：

```cpp
void CodeGen::LoadOperand(
    const IRValue& value,
    const char* reg,
    std::ostream& out
) const
{
    switch (value.kind)
    {
        case ValueKind::Integer:
        {
            const auto& integer =
                static_cast<const IRInteger&>(value);

            out << "  li " << reg << ", "
                << integer.value << "\n";

            return;
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

目前 `LoadOperand` 只需要处理整数立即数。

例如：

```text
IRInteger(0)
```

并要求加载到：

```text
a0
```

最终就会生成：

```asm
li a0, 0
```

于是整个调用过程就是：

```text
Generate(Program)
    ↓
Visit(Function main)
    ↓
Visit(BasicBlock entry)
    ↓
Visit(Return)
    ↓
LoadOperand(Integer(0), a0)
```

最终输出：

```asm
  .text
  .globl main
main:
  li a0, 0
  ret
```

至此，我们的编译器已经第一次完成了一条完整的编译链：

```text
SysY
 ↓
AST
 ↓
Koopa IR
 ↓
RISC-V Assembly
```

虽然目前支持的程序只有最简单的：

```c
int main()
{
    return 0;
}
```

但这里建立起来的 `CodeGen` 框架之后基本可以继续沿用。

随着后面的 SysY 语法逐渐复杂，我们主要需要不断扩展：

```text
Visit(...)
```

来支持新的 IR 指令，并逐步完善：

```text
LoadOperand(...)
```

对临时变量、寄存器和栈上数据的处理。
