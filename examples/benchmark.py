# ── Test 1: Tight loop — sum to 1 billion
s = 0
for i in range(1000000000):
    s += i
print(f"Sum to 1B: {s}")

# ── Test 2: Nested loops — matrix multiply (N=500)
total = 0
for i in range(500):
    for j in range(500):
        for k in range(500):
            total += 1
print(f"Matrix ops: {total}")

# ── Test 3: Fibonacci (iterative, N=80)
a, b = 0, 1
for i in range(80):
    a, b = b, a + b
print(f"Fib(80): {a}")
