# TDD: what to test, and through what

## Choosing the interface

Pick the outermost point where the behaviour can be observed cheaply.

| The ticket changes | Test through | Not through |
|---|---|---|
| A rule or a calculation | The exported function that callers use | The helpers it is made of |
| What a request returns or stores | The route or handler, with a real request | The query builder inside it |
| What a person sees or can do | The rendered component or page, by its visible text and roles | Component state, class names |
| A command-line tool | The command and its exit code and output | The functions behind the parser |
| A background job | The job's entry point and what it leaves behind | Its timers |

If the only way to test a behaviour is to reach inside, the design is telling you something: the
behaviour has no interface yet. Give it one, then test that.

## Fakes

- Fake what you do not own and cannot run: the network, the clock, a paid API.
- Do not fake your own modules. A test that replaces the code under test with a stand-in checks the
  stand-in.
- Prefer the real database the repo's tests already use over a mocked one.
- Never point a test at a live database.

## A good test

- Its name states the behaviour in words: "rejects a link that belongs to another person".
- It sets up only what this behaviour needs.
- It asserts the outcome, not the steps taken to reach it.
- It fails with a message that says what went wrong.
- It would fail if the code were wrong. Check by breaking the code on purpose once, if in doubt.

## Bad tests, and the repair

| Bad | Why | Repair |
|---|---|---|
| Asserts that a function was called | Passes when the result is wrong | Assert the result |
| Copies the implementation's formula into the expectation | Wrong twice is still green | Use a value worked out by hand |
| One test, six assertions on unrelated things | The first failure hides the rest | One behaviour per test |
| Snapshot of a whole page | Fails on any change, so it gets refreshed blindly | Assert the few things the ticket is about |
| Depends on the order tests run, or on the time of day | Fails at random | Give each test its own data; fix the clock |

## From a Done when to tests

Done when: «Al abrir el enlace de una lista que ya no está compartida se ve "Esta lista ya no está
compartida"».

Behaviours on the list:

1. A link to a list that is shared shows its products. *(Likely exists already: a guard.)*
2. A link to a list that stopped being shared shows the message and no products.
3. A link that never existed shows the same message, not an error page.

Three tests, written and made to pass one at a time, each through the page a person would open.
