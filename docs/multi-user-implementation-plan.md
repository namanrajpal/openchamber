# Implementation Plan: Multi-User OpenChamber

[Overview]
Transform OpenChamber from a single-user/team shared workspace into a multi-user application where each authenticated user gets isolated sessions and workspace while sharing organization-level API keys and template repositories.

This implementation maintains a single Fargate container approach for simplicity and cost-effectiveness (~$200/month total regardless of user count). Each user gets their own OpenCode server process within the container, with isolated EFS storage directories. Users can browse shared template repositories and clone them to their private workspace.

The architecture leverages the existing Cognito authentication flow, extracting user identity from the ALB-injected JWT headers. OpenCode is designed to handle multiple instances, so this approach scales to approximately 10-15 concurrent active users on the default 4vCPU/8GB Fargate configuration.

[Types]
Define new TypeScript types for user context, process management, and shared repository handling across the server and UI layers.

```typescript
// packages/web/server/lib/types/user-context.ts
export interface UserContext {
  /** Cognito user sub (unique identifier) */
  userId: string;
  /** User's email from Cognito claims */
  email: string;
  /** User's display name from Cognito claims */
  name?: string;
  /** User's home directory on EFS */
  homeDirectory: string;
  /** Whether user workspace is initialized */
  isInitialized: boolean;
}

export interface CognitoJwtClaims {
  sub: string;
  email?: string;
  name?: string;
  'cognito:username'?: string;
  exp: number;
  iat: number;
}

// packages/web/server/lib/types/opencode-pool.ts
export interface OpenCodeInstance {
  /** User ID this instance belongs to */
  userId: string;
  /** OpenCode server process */
  process: ReturnType<typeof createOpencodeServer> | null;
  /** Port OpenCode is running on */
  port: number;
  /** User's home directory */
  homeDirectory: string;
  /** Last activity timestamp */
  lastActivity: number;
  /** Instance state */
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';
  /** Error message if state is 'error' */
  error?: string;
}

export interface OpenCodePoolConfig {
  /** Maximum concurrent instances */
  maxInstances: number;
  /** Idle timeout before instance shutdown (ms) */
  idleTimeoutMs: number;
  /** Health check interval (ms) */
  healthCheckIntervalMs: number;
  /** Base port for dynamic allocation */
  basePort: number;
}

// packages/web/server/lib/types/shared-repos.ts
export interface SharedRepository {
  /** Repository name (directory name) */
  name: string;
  /** Full path on EFS */
  path: string;
  /** Description from .description file */
  description?: string;
  /** Last modified timestamp */
  lastModified: number;
  /** Size in bytes */
  sizeBytes: number;
}

export interface CloneRepositoryRequest {
  /** Source repository name */
  sourceName: string;
  /** Target directory name in user space */
  targetName?: string;
}

export interface CloneRepositoryResponse {
  success: boolean;
  targetPath?: string;
  error?: string;
}

// packages/ui/src/types/user.ts
export interface CurrentUser {
  id: string;
  email: string;
  name?: string;
}

export interface SharedRepo {
  name: string;
  description?: string;
  lastModified: number;
}
```

[Files]
Server-side files for user context management, OpenCode process pooling, and shared repository handling. UI components for user display and repository browsing.

**New Files to Create:**

Infrastructure:
- `infrastructure/aws/lib/constructs/multi-user-storage.ts` - EFS construct with shared + user directories

Server:
- `packages/web/server/lib/user-context.js` - Extract user identity from Cognito JWT
- `packages/web/server/lib/opencode-pool.js` - Manage per-user OpenCode instances
- `packages/web/server/lib/shared-repos.js` - Shared repository operations
- `packages/web/server/lib/user-workspace.js` - User workspace initialization

UI:
- `packages/ui/src/hooks/useCurrentUser.ts` - Hook to access current user context
- `packages/ui/src/hooks/useSharedRepos.ts` - Hook to fetch shared repositories
- `packages/ui/src/components/shared-repos/SharedReposBrowser.tsx` - Repository browser component
- `packages/ui/src/components/shared-repos/CloneRepoDialog.tsx` - Clone confirmation dialog
- `packages/ui/src/stores/useUserStore.ts` - User state management

Types:
- `packages/web/server/lib/types/user-context.d.ts` - Type definitions
- `packages/ui/src/types/user.ts` - UI type definitions

**Files to Modify:**

Infrastructure:
- `infrastructure/aws/lib/openchamber-stack.ts` - Add multi-user storage construct option
- `infrastructure/aws/lib/constructs/storage.ts` - Add user directory support
- `infrastructure/aws/docker/entrypoint.sh` - Initialize shared directory structure

Server:
- `packages/web/server/index.js` - Add user context middleware, per-user OpenCode routing
- `packages/web/server/lib/opencode-config.js` - User-scoped configuration paths

UI:
- `packages/ui/src/App.tsx` - Add user context provider
- `packages/ui/src/components/layout/Sidebar.tsx` - Add shared repos section

[Functions]
Key functions for user authentication, OpenCode process management, and repository operations.

**New Functions:**

`packages/web/server/lib/user-context.js`:
- `extractUserFromRequest(req)` - Extract UserContext from ALB Cognito headers
- `decodeAlbOidcData(headerValue)` - Decode X-Amzn-Oidc-Data JWT
- `getUserHomeDirectory(userId)` - Get user's EFS home path
- `isValidCognitoUser(claims)` - Validate JWT claims

`packages/web/server/lib/opencode-pool.js`:
- `getOrCreateInstance(userId, homeDirectory)` - Get existing or spawn new OpenCode
- `stopInstance(userId)` - Gracefully stop user's OpenCode process
- `stopAllInstances()` - Shutdown all instances (for graceful shutdown)
- `getInstanceStatus(userId)` - Check if user has running instance
- `cleanupIdleInstances()` - Stop instances idle past timeout
- `getPoolStats()` - Get current pool statistics

`packages/web/server/lib/user-workspace.js`:
- `initializeUserWorkspace(userId)` - Create user directory structure
- `symlinkSharedAuth(userId)` - Link org API keys to user space
- `isWorkspaceInitialized(userId)` - Check if user workspace exists
- `getUserWorkspacePath(userId, subpath)` - Resolve user-relative path

`packages/web/server/lib/shared-repos.js`:
- `listSharedRepositories()` - List all shared repos
- `cloneSharedRepository(userId, sourceName, targetName)` - Clone repo to user space
- `getSharedRepositoryInfo(name)` - Get single repo details

**Modified Functions:**

`packages/web/server/index.js`:
- `main()` - Add user context middleware, configure multi-user mode
- `setupProxy(app)` - Route to user's OpenCode instance based on context
- `gracefulShutdown()` - Stop all OpenCode instances before exit

`packages/web/server/lib/opencode-config.js`:
- `getAgentSources(agentName, directory)` - Consider user home for config resolution
- `getProviderSources(providerId, directory)` - Consider user home for auth resolution

[Classes]
No new classes required - using functional approach with module-level state for OpenCode pool management, consistent with existing codebase patterns.

[Dependencies]
No new npm packages required. The implementation uses existing dependencies:
- `jsonwebtoken` - Already available, for JWT decoding (verification done by ALB)
- `@opencode-ai/sdk/server` - Already used for OpenCode spawning
- Express middleware patterns already established

[Testing]
Testing approach for multi-user functionality.

**Manual Testing:**
1. Deploy to AWS with Cognito enabled
2. Create two test users in Cognito
3. Login as User A, create session, verify isolated workspace
4. Login as User B in different browser, verify separate sessions
5. Add shared repo, verify both users can see and clone it
6. Test idle timeout by leaving User A inactive

**Automated Testing:**
- `packages/web/server/__tests__/user-context.test.js` - JWT extraction tests
- `packages/web/server/__tests__/opencode-pool.test.js` - Instance lifecycle tests
- `packages/web/server/__tests__/user-workspace.test.js` - Directory initialization tests

**Integration Test Checklist:**
- [ ] User A and User B have separate sessions
- [ ] User A cannot see User B's sessions
- [ ] Shared API keys work for both users
- [ ] Shared repos visible to both users
- [ ] Clone creates copy in user's space
- [ ] Terminal sessions are user-isolated
- [ ] File operations are user-isolated
- [ ] Git operations use user's identity

[Implementation Order]
Sequential implementation steps to minimize conflicts and ensure working increments.

1. **Create multi-user EFS storage construct** - Define new directory structure while keeping backward compatibility

2. **Implement user context extraction** - Decode Cognito JWT from ALB headers, create UserContext

3. **Implement user workspace initialization** - Create user directories on first request, symlink shared auth

4. **Implement OpenCode instance pool** - Manage per-user OpenCode processes with idle cleanup

5. **Modify server to route per-user** - Add middleware to extract user, route API calls to user's OpenCode

6. **Implement shared repository API** - List, clone operations for shared repos

7. **Update container entrypoint** - Initialize shared directory structure on boot

8. **Add UI user context** - Display current user, add store for user state

9. **Add shared repos UI** - Browser component, clone dialog

10. **Update CDK stack** - Add toggle for multi-user mode, update environment variables

11. **Testing and documentation** - End-to-end testing, update README
