// ── Test 1: Tight loop — sum to 1 billion
let sum = 0;
for (let i = 0; i < 1000000000; i++) sum += i;
console.log(`Sum to 1B: ${sum}`);

// ── Test 2: Nested loops — matrix multiply (N=500)
let total = 0;
for (let i = 0; i < 500; i++)
  for (let j = 0; j < 500; j++)
    for (let k = 0; k < 500; k++)
      total += 1;
console.log(`Matrix ops: ${total}`);

// ── Test 3: Fibonacci (iterative, N=80)
let a = 0, b = 1;
for (let i = 0; i < 80; i++) { let t = a + b; a = b; b = t; }
console.log(`Fib(80): ${a}`);
