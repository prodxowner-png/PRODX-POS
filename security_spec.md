# Security Specification - Task Management App

## Data Invariants
1. A task must have a valid `ownerId` that strictly matches the `request.auth.uid` of the creator.
2. A task must have a non-empty `title` (1-200 chars).
3. The `ownerId` and `createdAt` fields are immutable after creation.
4. Users can only `read`, `create`, `update`, and `delete` their own tasks.
5. `updatedAt` must be set to the server timestamp on every write.

## The "Dirty Dozen" Payloads
These payloads are designed to test the security boundaries of the `/tasks/` collection.

1. **Identity Spoofing (Create)**: Create a task with `ownerId` set to another user's UID.
2. **Shadow Field Injection (Create)**: Create a task with an undocumented field `isAdmin: true`.
3. **Malicious ID (Create)**: Create a task with a document ID that is a 2KB string.
4. **Invalid Title Type (Create)**: Create a task where `title` is a boolean instead of a string.
5. **Missing Required Field (Create)**: Create a task without the `completed` field.
6. **Title Size Violation (Create)**: Create a task with a `title` exceeding 200 characters.
7. **Identity Spoofing (Update)**: Update another user's task.
8. **Immutability Breach (Update)**: Attempt to change the `ownerId` of an existing task.
9. **Immutability Breach (Update)**: Attempt to change the `createdAt` of an existing task.
10. **State Shortcutting (Update)**: Attempt to update a task without providing the `updatedAt` server timestamp.
11. **Cross-User Leak (List)**: Attempt to list all tasks without filtering by `ownerId`.
12. **Malicious ID (Get)**: Attempt to `get` a task using a document ID containing special characters like `../`.

## The Test Runner (firestore.rules.test.ts)
```typescript
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'modified-bit-mct7q';
const MY_ID = 'user_123';
const MY_AUTH = { uid: MY_ID, token: { email_verified: true } };
const OTHER_ID = 'user_456';
const OTHER_AUTH = { uid: OTHER_ID, token: { email_verified: true } };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await fs.readFile('firestore.rules', 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Task Management Security', () => {
  test('Dirty Dozen 1: Identity Spoofing (Create)', async () => {
    const db = testEnv.authenticatedContext(MY_ID).firestore();
    await assertFails(setDoc(doc(db, 'tasks', 'task_1'), {
      id: 'task_1',
      ownerId: OTHER_ID, // Spoofing
      title: 'Valid Title',
      completed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  test('Dirty Dozen 2: Shadow Field Injection (Create)', async () => {
    const db = testEnv.authenticatedContext(MY_ID).firestore();
    await assertFails(setDoc(doc(db, 'tasks', 'task_1'), {
      id: 'task_1',
      ownerId: MY_ID,
      title: 'Valid Title',
      completed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isAdmin: true, // Ghost field
    }));
  });

  test('Dirty Dozen 7: Identity Spoofing (Update)', async () => {
    // Setup: Create a task for OTHER_ID
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tasks', 'other_task'), {
        id: 'other_task',
        ownerId: OTHER_ID,
        title: 'Other Task',
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const db = testEnv.authenticatedContext(MY_ID).firestore();
    await assertFails(updateDoc(doc(db, 'tasks', 'other_task'), {
      title: 'Hacked Title',
      updatedAt: serverTimestamp(),
    }));
  });

  test('Dirty Dozen 8: Immutability Breach (Update)', async () => {
    const db = testEnv.authenticatedContext(MY_ID).firestore();
    const taskRef = doc(db, 'tasks', 'my_task');
    
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tasks', 'my_task'), {
        id: 'my_task',
        ownerId: MY_ID,
        title: 'My Task',
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await assertFails(updateDoc(taskRef, {
      ownerId: OTHER_ID, // Attempt to change owner
      updatedAt: serverTimestamp(),
    }));
  });
});
```
