---
title: Corpus feature sampler
tags: [a, b]
---

# ATX heading

Setext heading
==============

Second setext
-------------

## Closed ATX ##

Paragraph with *em*, _em_, **strong**, __strong__, ~~strike~~, `code`, ``co`de``,
a [link](https://example.com "title"), a [ref link][ref], <https://example.com>,
www.example.com, an ![image](img/pic.png), footnote[^1], :smile:, &copy; &#169;
and \*escaped\* characters.
Hard break with two spaces  
hard break with backslash\
end.

$$
\int_0^1 x^2 \, dx
$$

[toc]

> quote line one
lazy continuation
> > nested quote

- bullet
- [ ] task
- [x] done
- [X] done upper
  1. nested ordered
  2. second
     * deeper star
     + deeper plus

3) paren list
4) next

10. starts at ten
10. all-same

```js
console.log("fenced");
```

~~~~
tilde fence with ``` inside
~~~~

    indented code

| left | center | right |
|:-----|:------:|------:|
| a    |   b    |     c |
|x|y|z|

<div class="note">
  <p>HTML block</p>
</div>

<!-- comment -->

***
___
- - -

[ref]: https://example.com/ref "Ref title"
[^1]: Footnote text
    with continuation.
