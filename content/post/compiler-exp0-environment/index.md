---
title: "[从零开始的编译原理][实验] Exp Chapter 0：实验环境搭建"
date: 2026-09-28T16:36:25+08:00
slug: compiler-exp0-environment
series:
    - 技术分享
categories:
    - 编译原理
column:
    - 编译原理
tags:
    - 编译原理
    - 编译器实验
    - Docker
    - Koopa IR
    - RISC-V
seriesOrder: 3
math: true
comments: false
---

## Docker配置

根据课程指导书的要求，我们通过Docker拉取对应的镜像:

```bash
docker pull maxxing/compiler-dev
```

下面简单介绍一下Docker的使用方法。

首先我们需要简单区分一下镜像(image)和容器(container),前者可以看作是一个硬盘，里面装好了操作系统，但它是静态的，不能直接拿来运行。而后者则是一台计算机，里面装了硬盘，就能运行对应的操作系统。

在实际情况中，我们可以在容器中对文件系统进行修改，例如创建和删除文件，但是镜像不会受到影响。

通常而言，我们只希望在镜像的环境做一些一次性的工作，比如用里面的测试脚本来测试自己的编译器，然后查看测试结果。在此之后这个临时容器就没有任何作用了。

例如我们希望在上面image的环境中执行如下命令:`ls -l /`，那么我可以输入指令:

```bash
docker run maxxing/compiler-dev ls -l /
```

然后此时终端就会显示命令`ls -l /`的结果，此时会生成一个临时容器，我们可以用指令:`docker ps -a`查看:

```text
user@macbook compiler % docker ps -a                          
CONTAINER ID   IMAGE                  COMMAND   CREATED         STATUS                     PORTS     NAMES
441f432b9731   maxxing/compiler-dev   "ls -l"   3 seconds ago   Exited (0) 3 seconds ago             hopeful_shannon
```

那么我们可以通过指令:`docker rm 441f432b9731`来删除这个容器。

当然我们还可以将上述执行命令-删除临时容器的操作合并为一个指令:

```bash
docker run --rm maxxing/compiler-dev ls -l /
```

这样创造临时容器，运行完指令后，就会直接把临时容器给删掉了。

有时候，可能我们期望在容器中执行的命令很复杂，不能一行输入完整，那么此时我们可以使用

```bash
docker run -it --rm maxxing/compiler-dev bash
```

这样我们就创建了临时容器后，执行了bash指令，就可以在容器内的shell中工作输入任何指令了。其中`-it`参数是为了开启容器的stdin。

如果需要退出，直接输入`exit`即可

在大部分情况下，我们还希望Docker容器能够访问宿主机中的文件，如我们实现的编译器位于宿主机的`/path/to/compiler`目录下，我们希望 Docker 容器也能访问到这个目录里的内容, 这样你就可以使用容器中的测试脚本测试你的编译器了. 可以执行:

```bash
docker run -it --rm -v /path/to/compiler:/root/compiler maxxing/compiler-dev bash
```

这条命令多了一个`-v`参数，它的作用是把宿主机的某个目录挂载到容器的某个目录（例如上面指令是`/root/compiler`）。这样，在进入容器之后，就可以通过访问挂载的目录访问宿主机的目录了。

## Koopa IR介绍

Koopa IR是一种简化后的中间表示，在设计上类似LLVM IR。同时我们在后续lab中会用到对应的框架:

- <https://github.com/pku-minic/koopa>

Koopa IR 是一种强类型的 IR, IR 中的所有值 (Value) 和函数 (Function) 都具备类型 (Type). 

Koopa IR 中, 基本块 (basic block) 必须是显式定义的. 即, 在描述函数内的指令时, 你必须把指令按照基本块分组, 每个基本块结尾的指令只能是分支/跳转/函数返回指令之一. 在 IR 的数据结构表示上, 指令也会被按照基本块分类. 这很大程度上方便了 IR 的优化, 因为许多优化算法都是在基本块的基础上对程序进行分析/变换的.

假设我们有一个用Koopa IR编写的程序（见指导书中的"hello world!"），我们将其保存在了文件`hello.koopa`中，那么我们可以在实验环境中运行这个koopa IR程序:

```bash
koopac hello.koopa | llc --filetype=obj -o hello.o
clang hello.o -L$CDE_LIBRARY_PATH/native -lsysy -o hello
./hello
```

## RISC-V介绍

我们的编译器最终会生成RISC-V汇编。

RISC-V的指令系统由

基础指令系统 (base instruction set) 和指令系统扩展 (extension) 构成. 每个 RISC-V 处理器必须实现基础指令系统, 同时可以支持若干扩展. 常用的基础指令系统有两种:

- `RV32I`: 32 位整数指令系统.
- `RV64I`: 64 位整数指令系统. 兼容 `RV32I`.

常用的标准指令系统扩展包括:

- `M` 扩展: 包括乘法和除法相关的指令.
- `A` 扩展: 包括原子内存操作相关的指令.
- `F` 扩展: 包括单精度浮点操作相关的指令.
- `D` 扩展: 包括双精度浮点操作相关的指令.
- `C` 扩展: 包括常用指令的 16 位宽度的压缩版本.

我们通常使用 `RV32/64I` + 扩展名称的方式来描述某个处理器/平台支持的 RISC-V 指令系统类型, 例如 `RV32IMA` 代表这个处理器是一个 32 位的, 支持 `M` 和 `A` 扩展的 RISC-V 处理器.

在我们的Lab中，我们编译器将生成`RV32IM`范围内的RISC-V汇编。

假设我们有一段RISC-V的汇编程序:`hello.S`，我们可以在实验环境中将这个RISC-V程序汇编并链接为可执行文件并运行起来:

```bash
clang hello.S -c -o hello.o -target riscv32-unknown-linux-elf -march=rv32im -mabi=ilp32
ld.lld hello.o -L$CDE_LIBRARY_PATH/riscv32 -lsysy -o hello
qemu-riscv32-static hello
```

## 编程语言选择

为了方便起见，我最终还是选择使用C++进行开发。

我们使用CMake模版:<https://github.com/pku-minic/sysy-cmake-template>

配置好环境后，我们可以进入docker环境中，执行命令:

```bash
cmake -DCMAKE_BUILD_TYPE=Debug -B build
cmake --build build
```

构建编译器，后续如果我们更改了代码，则仅仅需要通过:

```bash
cmake --build build
```

即可。
