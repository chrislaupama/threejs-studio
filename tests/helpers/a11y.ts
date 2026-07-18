import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function expectNoSeriousAccessibilityViolations(
  page: Page,
  context: string,
  include?: string,
) {
  let scan = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) scan = scan.include(include);

  const { violations } = await scan.analyze();
  const seriousOrCritical = violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map(({ target }) => target.join(' ')),
    }));

  expect(seriousOrCritical, `${context} has serious or critical axe violations`).toEqual([]);
}

