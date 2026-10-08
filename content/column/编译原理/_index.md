---
title: "从零开始的编译原理"
# Left sidebar entry (active on this page).
menu:
  main:
    name: 编译原理
    weight: 7
    params:
      icon: code
description: "借着 Gap Year 系统性地重新学习编译原理：课程笔记参考 NJU 编译，实验参考 PKU 编译（SysY → Koopa IR → RISC-V），最终走向 AI compiler（TVM / MLC）。"

# Course-style landing page (layouts/_partials/column/syllabus.html).
# Chapter cards come from the posts in this column automatically: each post
# goes to the section named by its title prefix "[从零开始的编译原理][理论|实验]",
# ordered by `seriesOrder`. Only not-yet-published chapters are listed here.
syllabus:
  # Number h2–h4 in this column's posts like the TOC (1. / 1.1. / 1.1.1.).
  numberHeadings: true
  tracks:
    - name: 理论
      title: 课程文档
      subtitle: 课程笔记，参考 NJU 编译
      badge: CH
    - name: 实验
      title: 实验文档
      subtitle: 实验参考 PKU 编译：SysY → Koopa IR → RISC-V
      badge: EXP
  upcoming:
    - track: 实验
      title: "Exp Chapter 3：一元 / 二元表达式"
  references:
    - name: PKU 编译
      url: https://pku-minic.github.io/online-doc/#/
      kind: Assignment
    - name: NJU 编译
      url: https://csdiy.wiki/编译原理/NJU-Compilers/
      kind: Course
    - name: TVM
      url: https://mlc.ai/summer22-zh/
      kind: AI compiler
---

想学习一下AI compiler，但是苦于大三的时候学习编译太过于赶工几乎全程vibe coding，导致没咋学，因此借着大四Gap Year好好系统性的学习一下，本次参考的学习资料包括但不限于:

{{< column-refs >}}

希望能够坚持下去
