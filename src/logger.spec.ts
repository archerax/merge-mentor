import { describe, expect, it } from 'vitest';
import { createChildLogger, logger } from './logger.js';

describe('Logger', () => {
  it('creates root logger', () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it('creates child logger with context', () => {
    const childLogger = createChildLogger({ component: 'TestComponent', userId: '123' });
    expect(childLogger).toBeDefined();
    expect(childLogger.info).toBeDefined();
  });

  it('child logger inherits parent methods', () => {
    const childLogger = createChildLogger({ service: 'TestService' });
    expect(typeof childLogger.info).toBe('function');
    expect(typeof childLogger.error).toBe('function');
    expect(typeof childLogger.warn).toBe('function');
    expect(typeof childLogger.debug).toBe('function');
  });
});
