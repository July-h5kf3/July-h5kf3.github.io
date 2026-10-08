---
title: "[从零开始的编译原理][理论] Chapter 2：语法分析"
date: 2026-10-03T15:32:40+08:00
slug: compiler-ch2-syntax-analysis
series:
    - 技术分享
categories:
    - 编译原理
column:
    - 编译原理
tags:
    - 编译原理
    - 语法分析
    - ANTLR
    - CFG
    - LL(1)
seriesOrder: 2
math: true
comments: false
---

这一节我们主要学习的是语法分析。

## 语法分析

在进行完词法分析后，我们得到了一组Token序列，而语法分析则用来分析这些token之间的结构关系。

例如我们有一个表达式:

```text
a = b + 3 * 4;
```

经过词法分析后，我们可以得到:

```text
ID(a) = ID(b) + NUM(3) * NUM(4);
```

那么它应该被解析为:

```text
b + (3 * 4)
```

对应这个AST:

```text
        +
       / \
      b   *
         / \
        3   4
```

语法分析器同样有三种实现方法：

1. 语法分析器生成器
2. 手写语法分析器
3. 自动化语法分析器

我们按照同样的顺序，介绍如何用语法分析器生成器来进行语法分析，以及自动化语法分析器背后的基本原理。

## 语法分析器生成器

在本节中，我们继续用antlr来设计一个类C 语言的grammer: `Cymbol.g4`( [github](https://github.com/remenska/Grammars/blob/master/book-examples/examples/Cymbol.g4)实现参考，我们下面的可能有细微的不同),这一次，我们重点关心其中的语法部分。

在生成语法分析器的同时，我们还会利用这个分析器去抽取函数调用图.

### Cymbol 的语法规则实现

接下来我们先来尝试用antlr来描述`Cymbol.g4`这个语言的语法结构，我们采用从上到下的描述顺序。

首先，整个程序，我们可以认为是有若干个变量声明和函数声明构成的，因此我们可以写出第一条语法规则:

```text
prog : (varDecl | functionDecl)* EOF ;
```

那么接下来我们就需要去写变量声明和函数声明的语法:

变量声明写作:

```text
varDecl : type ID ('=' expr)? ';' ;
type : 'int' | 'double' | 'void' ;
```

其中括号中的内容是变量初始值声明，这是一个可选的，因此我们括号后面用？描述

函数声明则写作:

```text
functionDecl : type ID '(' formalParameters ? ')' block ;
formalParameters : formalParameter (',' formalParameter)* ;
formalParameter : type ID ;
```

其中，`formalParameters`还可以写作递归形式:

```text
formalParameters : formalParameters ',' formalParameter
                 | formalParameter
                 ;
```

接下来我们看看函数体`block`的语法规则:

```text
block : '{' stat* '}' ;
stat : block
     | varDecl
     | 'if' expr 'then' stat ('else' stat)?
     | 'return' expr? ';'
     | expr '=' expr ';'
     | expr ';'
     ;
```

其中 stat定义的第一行中调用了block，而block又调用了stat，这是一种互递归。

接下来我们重点看看一个`expr`也就是表达式的语法规则应该是怎样的:

```text
expr : ID '(' exprList ? ')' # 表达函数调用
     | expr '[' expr ']' # 表达下标
     | '-' expr
     | '!' expr
     | expr '^' expr
     | expr ('*' | '/') expr
     | expr ('+' | '-') expr
     | expr ('==' | '!=') expr
     | '(' expr ')'
     | ID
     | INT;
exprList : expr (',' expr)* ;
```

### 一些问题

在上一小节中，我们初步完成了Cymbol语言的语法规则定义，但是上述语法规则会存在一定的问题:

```text
if a then if b then c else d
```

我们现在用上面的语法规则去解析这个语句，发现有两种解析方法:

```text
if a then [if b then c] else d
if a then [if b then c else d]
```

这就是语言的二义性，在设计语法分析器时，我们应该消除这种二义性。

这种二义性叫做Dangling Else二义性

一种消除的方式是改写上述匹配规则:

简单来说，我们规定`else`总是和最近的，尚未匹配`else`的`if`匹配。

为了体现这种规则，我们把语句分为两类: `matched`和`open`,那么此时文法可以写作:

```text
stat : matched_stat | open_stat;

matched_stat : 'if' expr 'then' matched_stat 'else' matched_stat
             | expr
             ;
             
open_stat : 'if' expr 'then' stat
          | 'if' expr 'then' matched_stat 'else' open_stat
          ;
```

在这种文法下，我们上面的例子，就只会匹配第二种解析方法了。

而在antlr这样的语法分析器生成器中，则巧妙的用最前优先匹配原则解决了这个问题。

除了悬空的Else带来的二义性外，运算符的结合性也有可能带来二义性:

```text
expr : expr '*' expr
     | expr '-' expr
     | DIGIT
     ;
```

例如`1-2-3`,此时可能是`(1-2)-3`也可以被识别为`1-(2-3)`这实际上是一个左结合，右结合的问题，由于大部分的运算符都是左递归的，因此像antlr这样的语法分析器生成器都是默认左结合的，那自然就会带来一个问题，那右递归的运算符怎么办？  
一般来说，右递归的运算符大多都是前缀运算符或后缀运算符，这种运算符只有一种匹配规则，因此不太需要考虑二义性，而真正需要考虑二义性的就是像`^`这样的右递归运算符。

对于这一类需要右结合的运算符，在antlr中，我们可以手动指定结合的方式:

```text
expr : '!' expr
     | <assoc = right> expr '^' expr
     | DIGIT
     ;
```

其他语法分析器生成器也存在类似的手动指定左/右结合的功能。

### 利用语法分析器得到函数调用图

通过语法分析器，我们最终可以得到一个AST，而antlr提供了一个接口:`ParseTreeWalker`,它可以以DFS的方式自动遍历整个AST，并且我们可以利用`Listener`来负责监听进入，退出节点的事件。

假设我们要得到函数调用图，那么一个必要的事情就是得到每个函数的名称。那利用`Listener`就很好实现这一点了，我们只需要每次监听到事件:`functionDecl Enter`就记录下节点的函数名称就能获取所有的函数名称了。

得到了所有函数的名称之后，我们还需要得到函数之间的调用关系，根据我们的语法规则，我们可以知道，函数调用语句会被语法规则:

```text
expr : ID '(' exprList ? ')'
     | expr '[' expr ']'
     | '-' expr
     | '!' expr
     | expr '^' expr
     | expr ('*' | '/') expr
     | expr ('+' | '-') expr
     | expr ('==' | '!=') expr
     | '(' expr ')'
     | ID
     | INT;
exprList : expr (',' expr)* ;
```

识别，因此我们只需要识别到函数调用事件之后，由调用函数向被调用函数连一条边即可。但是比较麻烦的点在于，除了函数调用，expr还有多条解释规则，而`Listener`并不会对上述规则作区分，我们能看到的只有`expr Enter`以及`expr Exit`,要在此基础上识别出函数调用，我们还需要补充大量的if语句做判断，这显然不是我们希望的。

事实上，在antlr中，是支持对每条规则用`#`来加标签的:

```text
expr : ID '(' exprList ? ')' # functionCall
     | expr '[' expr ']' 
     | '-' expr
     | '!' expr
     | expr '^' expr
     | expr ('*' | '/') expr
     | expr ('+' | '-') expr
     | expr ('==' | '!=') expr
     | '(' expr ')'
     | ID
     | INT;
exprList : expr (',' expr)* ;
```

这样，我们就可以通过`Listener`得到事件:`functionCall Enter/Exit`了。

## 语法分析的基本原理（1） CFG

我们先来看文法的组成:

```text
functionDecl : type ID '(' formalParameters? ')' block;
```

每个文法规则都由`:`分隔为两部分，其中前面部分我们称为头部(Head),后者为规则体(Body)。整个规则我们称作产生式(Production).

每个产生式的头部都是非终结符。而所有没有出现在头部的符号，我们称作终结符，他们对应于我们词法分析器中产生的词法单元。

这种文法，我们称作上下文无关文法（Context-Free Grammar CFG）。

一个上下文无关文法通常写作:

$$
G = (V,T,P,S)
$$

分别代表:

- V：非终结符
- T：终结符
- P：产生式
- S：开始符号

用数学符号表示就是:

$$
A\in N\to \alpha \in (T \cup N)^*
$$

接下来我们介绍一下CFG的语义:

这里会涉及到几个基本概念:

1. **推导**：推导顾名思义就是用产生式对终结符进行替换，例如:

我们用规则:

$$
E \to E + E | E * E | (E) | -E | id
$$

从E得到字符串：`-(id + id)`

那么推导的流程我们可以写作 :

$$
E \to -E \to -(E)\to-(E+E)\to -(id+E)\to-(id + id)
$$

这其中还会涉及到一个**最左推导**和**最右推导**的概念，二者的区别在于，前者在推导时总是选择最左侧的非终结符进行推导，而后者则是选择最右侧的非终结符。

另外，我们会标记:

- $E \Rightarrow -E  $：经过一步推导得出
- $E\xRightarrow{+}-(id+E)$：经过一步或多步推导得出
- $E\xRightarrow{*}-(id+E)$：经过零步或多步推导得出

2. **句型**: 如果 $S \xRightarrow{*} \alpha,\alpha \in (T\cup N)^*$,则称 $\alpha$是文法G的一个**句型。**
3. **句子**：如果 $S \xRightarrow{*} \omega,\omega \in T*$,则称 $\omega$为文法G的一个**句子**
4. 文法G的**语言**L(G)是它能推导出的**所有句子**构成的集合 : $L(G) = \{\omega | S\xRightarrow{*} \omega\}$

关于文法G，我们主要关心两个主要问题:

1. Membership 问题，即给定一个字符串，该字符串是否属于该文法产生的语言L(G)？
2. L(G)究竟是什么？

其中，第一个问题就是编译器语法分析器的任务，为输入的词法单元流寻找推导，构建语法分析树或者报错。

而第二个问题则是程序设计者需要考虑的问题。

这个问题通常体现在这样的题目上: 请给出文法，满足: $\{x \in \{a,b\}^*| x中a,b数目相同\}$

一个可能的文法是: $V\to VV|aVb|bVa|\epsilon$

下面简单证明一下为什么？

我们可以先证明**文法生成的串一定满足a,b数目相同**:

我们记: $\#_a(x)$表示串x中字符a的数目。

我们证明采用归纳法。

- $V \Rightarrow \epsilon$,显然，此时满足 $\#_a(\epsilon) = \#_b(\epsilon)=0$
- 若 $V\xRightarrow{*} x$,且x中字符a和b的数目相同，那么有: $V\Rightarrow aVb\xRightarrow{*}axb$,同时增加一个a和一个b，所以仍然相同，同理`bVa`以及VV仍然成立。

所以我们有: $L(G)\subseteq L$

接下来证明**所有a,b数目相同的字符串都能被这个文法生成**

对串长 $|x|$做归纳。

若$|x|=0$，则 $x=\epsilon$，有 $V \Rightarrow \epsilon$

假设所有长度小于n，且有: $\#_a(x) = \#_b(x)$的串都能由V生成。

考虑长度为n的串$x = x_1x_2\dots x_n$,且有  $\#_a(x) = \#_b(x)$。

首先讨论首尾字符不同的串，比如 `x=ayb`,由于整个x中a,b数目相同，去掉一个a和一个b后，y中仍然满足:

$\#_a(y) = \#_b(y)$.由归纳假设 $V \xRightarrow{*} y$.

因此 $V \Rightarrow aVb \xRightarrow{*}ayb=x$,若`x=bya`，同理。

然后考虑首尾字符相同的串，我们假设首尾字符都是a，且定义前缀的差值:

$$
d(k) = \#_a(x_1\dots x_k) - \#_b(x_1\dots x_k)
$$

因为第一个字符是a所以有: $d(1)=1$,而最后一个字符为a，因此 $d(n-1)=-1$,而 $d(k)$每读一个字符只会变化+1或者-1。因此从 $d(1)=1$到 $d(n-1)=-1$的过程中肯定存在某个k满足: $d(k)=0$.

于是我们可以把字符串x分为:$x=yz$,其中y，z都非空，且分别满足:

$$
\#_a(y) = \#_b(y),\#_a(z)=\#_b(z)
$$

又因为: $|y|,|z| < |x|$,由归纳假设我们知道:

$$
V\xRightarrow{*} y,V\xRightarrow{*}z
$$

因此使用 $V \Rightarrow VV$,有:

$$
V\Rightarrow VV\xRightarrow{*}yz=x
$$

对于首尾为b的串同理。因此，我们证明了:

$$
L \subseteq L(G)
$$

综上

$$
L(G) = \{x\in\{a,b\}^*|\#_a(x)=\#_b(x)\}
$$

## 语法分析的基本原理（2） LL

接下来我们重点考虑一下和我们语法分析器背后原理相关的问题：  
Membership 问题，即给定一个字符串，该字符串是否属于该文法产生的语言L(G)

我们语法分析要做的事情，无非就是根据词法单元流构建语法分析树。在构建时，我们有两种思路，自顶向下和自底向上。

我们先来介绍第一种: **自顶向下的，递归下降的，基于预测分析表的，适用于LL(1)文法的LL(1)语法分析器。**

其中自顶向下就是说我们在构建语法分析树时，是从根节点（文法的起始符号）往叶节点（词法单元）构建的。而中间每个中间节点表示对某个非终结符应用某个产生式进行推导。

而递归下降就是说，我们会为每个非终结符写一个递归函数，内部按需调用其他非终结符对应的递归函数，下降一层。

我们以下面这个文法的匹配来展示一下递归下降的过程:

$S \to F,S\to (S+F),F\to a$,匹配的文本是:`((a+a)+a)`

我们从起始符号S开始，首先第一步显然是匹配文法: $S\to (S+F)$

接下来遍历目前的词法单元，对于终结符直接跳过，否则进行递归展开，比如我们遇到第一个S时，将其展开: $S\to (S+ F)$,而第一个F时， $F\to a$,从而得到串: $((S+F)+a)$

按照上一步的流程，不断展开非终结符，最终匹配`((a+a)+a)`

那么在语法分析的过程中，自然就会产生一些问题，应该选择哪个终结符进行展开？应该选择采用哪个产生式进行推导？

对于LL(1)语法分析器而言，我们在推导的每一步都是选择最左边的非终结符进行展开。

而对于第二个问题，我们在LL(1)语法分析器中，通常借助预测分析表确定:

在上面的例子中，我们会通过某种算法得到如下预测分析表:

|  | ( | ) | a | + | \$ |
|-|-|-|-|-|-|
| S | 2 |  | 1 |  |  |
| F |  |  | 3 |  |  |

这张表指明了每个非终结符在面对不同的词法单元或文件结束符时，该选择哪个产生式或者报错。

有了这张表，匹配就很简单了，我们只需要当需要对非终结符进行推导时，看看此时匹配的串的非终结符，然后选择相应的规则进行推导即可。

而重点是，我们如果根据文法，构建出预测分析表。

我们定义: $\text{FIRST}(\alpha)$是可以从 $\alpha$推导得到的句型的首个终结符的集合。形式化定义为:

$$
\text{FIRST}(\alpha)=\{ t\in T \cup \{\epsilon\} | \alpha \xRightarrow * t\beta \lor \alpha \xRightarrow * \epsilon \}
$$

我们定义: $\text{FOLLOW}(A)$是可能在某些句型中紧跟在A右侧的终结符集合。形式化定义为:

$$
\text{FOLLOW}(A) = \{t\in T \cup \{\$\} | \exist s. S\xRightarrow* s \triangleq \beta At\gamma \}
$$

我们接下来看如何计算这两个集合。

我们这样计算每个符号X的 $\text{FIRST}$集合:

若X是终结符，那么 $\text{FIRST}(X) = X$;

若X是非终结符，那么 $\text{FIRST}(X) \leftarrow \text{FIRST}(X)\cup \{\text{FIRST}(Y_1) / \epsilon\}$,其中 $X \to Y_1Y_2\dots Y_k$

另外，对于 $Y_2-Y_k$,若 $\epsilon \in L(Y_1,\dots,Y_i)$,那么有: $\text{FIRST}(X) \leftarrow \text{FIRST}(X) \cup \{\text{FIRST}(Y_i) / \epsilon\}$

特别地，若: $\epsilon \in L(Y_1,\dots,Y_k)$,那么 $\text{FIRST}(X) \leftarrow \text{FIRST}(X) \cup \{ \epsilon\}$

我们以下面的文法进行一次 $\text{FIRST}(X)$计算的演示(为了方便，我们用F(x)代替):

$$
(1) X \to Y, (2)X \to a,(3)Y\to \epsilon,(4)Y\to c,(5)Z\to d,(6)Z\to XYZ
$$

我们先算 F(x),我们根据文法 $X\to Y$知道，我们需要先算F(Y).

由文法 $Y\to \epsilon,Y\to c$我们可以知道: $F(Y) = \{c,\epsilon\}$

计算完F(Y)后，我们可以进一步得到 $F(X) = \{a,c,\epsilon\}$，其中F(X)包含 $\epsilon$则是根据最后一条规则

最后我们计算F(Z),首先由 $Z\to d$，我们有 $\{d\}\subseteq F(Z)$,再看: $Z\to XYZ$

根据计算方法，我们先看X，此时我们有:  
$F(Z)\leftarrow F(Z) \cup \{F(X) / \epsilon\} = \{a,c,d\}$

而由于 $X \Rightarrow \epsilon$,因此我们还需要看Y，此时我们得到 $\{a,c,d\}\subseteq F(Z)$,而由于Y也可以推出 $\epsilon$

因此我们最后还需要看Z，就得到了: $F(Z) = \{a,c,d\}$

需要注意的是，Z推不出 $\epsilon$，因此F(Z)中并不会含有它。

我们这样计算每个符号X的 $\text{FOLLOW}$(X)

若X是开始符号，那么有: \(\text{FOLLOW}(X)\leftarrow \text{FOLLOW}(X)\cup \{\$\}\)

若X是某个产生式右部的最后一个符号： $A \to \alpha X$： $\text{FOLLOW}(X)\leftarrow \text{FOLLOW}(X) \cup \text{FOLLOW}(A)$

若X是某个产生式的右部的中间的一个符号: $A\to \alpha X \beta$: $\text{FOLLOW}(X)\leftarrow \text{FOLLOW}(X)\cup (\text{FIRST}(\beta) / \{\epsilon\})$

特别地，若此时 $\epsilon \in \text{FIRST}(\beta)$,那么 $\text{FOLLOW}(X)\leftarrow \text{FOLLOW}(X)\cup \text{FOLLOW}(A)$

还是一样，我们以上面的文法为例，展示 $\text{FOLLOW}$集合的计算方法。

我们首先处理开始符号X，因为X是开始符号，我们显然有：

\(\$ \in \text{FOLLOW}(X)\),所以目前： \(\text{FOLLOW}(X) = \{\$\}\)

接下来根据生产式: $X\to Y$，以及规则2，我们有: $\text{FOLLOW}(X)\subseteq \text{FOLLOW}(Y)$

因此目前: \(\text{FOLLOW}(Y) = \{\$\}\)

接下来看 $Z\to XYZ$.

对X而言，后面跟着YZ，所以要把 $\text{FIRST}(YZ) -\{\epsilon\}$,加入到 $\text{FOLLOW}(X)$中，因此我们需要计算:

$$
\text{FIRST}(YZ) = \{ a,c,d\}
$$

因此: \(\text{FOLLOW}(X) = \{\$,a,c,d\}\)

对于Y而言，后面跟着Z，所以有:

$\text{FIRST}(Z) -\epsilon \subseteq \text{FOLLOW}(Y)$,而: $\text{FIRST}(Z) = \{a,c,d\}$

因此: \(\text{FOLLOW}(Y) = \{\$,a,c,d\}\)

而Z根据规则1知道是一个空集。

得到了FIRST集和FOLLOW集后，我们可以开始构造给定文法的预测分析表了。

通常而言，预测分析表写作: `M[A,a]`,其中行为非终结符A，列尾终结符a，单元格内则填写应该选择哪个产生式。

填表规则只有两条。

对于产生式 $A\to \beta$

若 $a\in \text{FIRST}(\beta)-\{\epsilon\}$那么有: $M[A,a] = A\to \beta$;

若 $\epsilon \in \text{FIRST}(\beta)$,那么对于所有的: $b\in \text{FOLLOW}(A)$都有: $M[A,b] = A\to \beta$.

在实际计算中我们通常会先计算产生式 $A\to\beta$的 $\text{SELECT}$集合

我们定义: $\text{SELECT}(A\to\beta)$

若： $\epsilon \notin \text{FIRST}(\beta)$,那么 $\text{SELECT}(A\to\beta) = \text{FIRST}(\beta)$

若： $\epsilon \in \text{FIRST}(\beta)$,那么 $\text{SELECT}(A\to \beta) = (\text{FIRST}(\beta)-\{\epsilon\})\cup \text{FOLLOW}(A)$

得到 $A\to\beta$的SELECT集后，对该集合中每一个终结符a，把生产式 $A\to\beta$填入`M[A,a]`

还是上面那个例子，我们来手算一遍:

我们知道:

$$
\begin{aligned} (1)\quad &X\to Y\\ (2)\quad &X\to a\\ (3)\quad &Y\to \epsilon\\ (4)\quad &Y\to c\\ (5)\quad &Z\to d\\ (6)\quad &Z\to XYZ \end{aligned}
$$

$$
\begin{aligned} FIRST(X)&=\{a,c,\epsilon\}\\ FIRST(Y)&=\{c,\epsilon\}\\ FIRST(Z)&=\{a,c,d\} \end{aligned}
$$

$$
\begin{aligned} FOLLOW(X)&=\{a,c,d,\$\}\\ FOLLOW(Y)&=\{a,c,d,\$\}\\ FOLLOW(Z)&=\varnothing \end{aligned}
$$

那么对于产生式（1） $X\to Y$,因为: $\text{FIRST}(Y) = \{c,\epsilon\}$,其中包含了 $\epsilon$，因此:

$$
\text{SELECT}(X\to Y) = \{a,c,d,\$\}
$$

对于产生式（2） $X \to a$,这里 $\text{FIRST}(a) = \{a\}$，不包含 $\epsilon$,因此: $\text{SELECT}(X\to a) =\{a\} $

按照同样的思路，我们可以求出每个产生式的 $\text{SELECT}$集，从而得到最终的预测分析表:

| 非终结符 | a | c | d | \$ |
| --- | --- | --- | --- | --- |
| X | (1), (2) | (1) | (1) | (1) |
| Y | (3) | (3), (4) | (3) | (3) |
| Z | (6) | (6) | (5), (6) | error |
