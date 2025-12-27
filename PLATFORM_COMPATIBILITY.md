# Platform Compatibility

merge-mentor is designed to work seamlessly across Windows, macOS, and Linux.

## Verified Compatibility

### Operating Systems
- ✅ **Linux** - Primary development and testing platform
- ✅ **Windows 10/11** - Full support with proper command escaping
- ✅ **macOS** - Native support

### Node.js Versions
- Node.js 20.x or higher required
- Tested on Node.js 20 LTS

## Technical Implementation

### Cross-Platform Command Execution
- Uses `child_process.spawn()` with array-based arguments for proper escaping on all platforms
- Explicit `shell: false` ensures consistent behavior across Windows/Unix
- No shell-specific syntax (no bash, PowerShell, or cmd.exe dependencies)

### Path Handling
- All file paths use `path.join()` from Node.js
- No hardcoded forward slashes or backslashes
- Configuration and logs use `process.cwd()` for proper working directory handling

### Environment Variables
- Build scripts use `cross-env` for cross-platform environment variable support
- No Unix-specific `export` or Windows-specific `set` required in code

### File System Operations
- Uses `node:fs/promises` API which is platform-agnostic
- Proper handling of line endings (CRLF on Windows, LF on Unix)

## Platform-Specific Notes

### Windows
- **Copilot CLI**: Must be installed and accessible in PATH (Windows will automatically resolve `copilot` to `copilot.exe`)
- **Environment Variables**: Use PowerShell `$env:VAR="value"` or Command Prompt `set VAR=value`
- **File Paths**: Backslashes and forward slashes both work (Node.js normalizes them)

### macOS
- **Copilot CLI**: Install via npm globally
- **Environment Variables**: Use `export VAR=value` in terminal or add to `.zshrc`/`.bash_profile`
- **File Permissions**: May need to grant terminal permissions for file access

### Linux
- **Copilot CLI**: Install via npm globally or use system package manager
- **Environment Variables**: Use `export VAR=value` in terminal or add to `.bashrc`/`.profile`
- **File Permissions**: Ensure write permissions for `.merge-mentor/` directory

## Testing

The entire test suite runs successfully on Linux. For Windows and macOS testing:

```bash
# Run unit tests
pnpm test

# Run integration tests
pnpm test:integration

# Run all tests
pnpm test:all
```

## Known Issues

None at this time. If you encounter platform-specific issues, please report them on GitHub.

## Development

When contributing, ensure all code follows cross-platform best practices:

1. ✅ Use `path.join()` for all path operations
2. ✅ Use `spawn()` with array arguments (not shell strings)
3. ✅ Avoid platform-specific shell commands
4. ✅ Test with `cross-env` for environment variables
5. ✅ Use `process.cwd()` for working directory paths
