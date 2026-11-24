import { execFileSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appConfig } from '../../config/app.config';
import { pmdAdapter, PMD_RULES } from './pmd.adapter';

// Against the real PMD, where it is installed (CI installs it). Checks that every rule
// Lens asks for exists in this PMD version, and what PMD finds in a small Java file.
const pmdInstalled = (() => {
  try {
    execFileSync(appConfig.pmdBin, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
})();

const CODE = `import java.sql.*;
import java.text.SimpleDateFormat;

public class UserDao {
    private static final SimpleDateFormat FORMAT = new SimpleDateFormat("yyyy-MM-dd");
    private String cache;

    public String findRole(String name) throws SQLException {
        Connection conn = DriverManager.getConnection("jdbc:h2:mem:test");
        Statement st = conn.createStatement();
        ResultSet rs = st.executeQuery("SELECT role FROM users WHERE name = '" + name + "'");
        if (name == "admin") {
            return "admin";
        }
        try {
            return rs.getString(1);
        } catch (SQLException e) {
        }
        return FORMAT.format(new java.util.Date());
    }
}
`;

describe.skipIf(!pmdInstalled)('the PMD adapter, with the real PMD', () => {
  let enabled: boolean;
  beforeAll(() => {
    enabled = appConfig.pmdEnabled;
    appConfig.pmdEnabled = true;
  });
  afterAll(() => {
    appConfig.pmdEnabled = enabled;
  });

  it('runs every rule it asks for, and finds the problems in a Java file', async () => {
    const findings = await pmdAdapter.analyze({ filename: 'UserDao.java', safeFilename: 'UserDao.java', language: 'java', code: CODE });

    const rules = findings.map((f) => /\((\w+)\)$/.exec(f.message)?.[1]);
    expect(rules.every((r) => r && r in PMD_RULES)).toBe(true);
    for (const rule of ['CloseResource', 'UseEqualsToCompareStrings', 'EmptyCatchBlock', 'UnusedPrivateField', 'UnsynchronizedStaticFormatter']) {
      expect(rules).toContain(rule);
    }
    expect(findings.find((f) => f.message.endsWith('(UseEqualsToCompareStrings)'))?.line).toBe(12);
  }, 60_000);

  it('reports a file it cannot parse as one syntax error', async () => {
    const findings = await pmdAdapter.analyze({ filename: 'Broken.java', safeFilename: 'Broken.java', language: 'java', code: 'class Broken {\n  void f( {\n}\n' });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: 'bug', severity: 'high', source: 'pmd' });
    expect(findings[0].message).toMatch(/^Java syntax error/);
    expect(findings[0].line).toBeGreaterThan(0);
  }, 60_000);
});
