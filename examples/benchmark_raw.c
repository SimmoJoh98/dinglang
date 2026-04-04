#include <stdio.h>
#include <stdint.h>

int main() {
    // ── Test 1: Tight loop — sum to 1 billion
    int64_t sum = 0;
    for (int64_t i = 0; i < 1000000000; i++) sum += i;
    printf("Sum to 1B: %lld\n", (long long)sum);

    // ── Test 2: Nested loops — matrix multiply (N=500)
    int64_t total = 0;
    for (int i = 0; i < 500; i++)
        for (int j = 0; j < 500; j++)
            for (int k = 0; k < 500; k++)
                total += 1;
    printf("Matrix ops: %lld\n", (long long)total);

    // ── Test 3: Fibonacci (iterative, N=80)
    int64_t a = 0, b = 1;
    for (int i = 0; i < 80; i++) { int64_t t = a + b; a = b; b = t; }
    printf("Fib(80): %lld\n", (long long)a);

    return 0;
}
