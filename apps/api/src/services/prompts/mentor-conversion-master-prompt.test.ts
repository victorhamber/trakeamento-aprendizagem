import { describe, expect, it } from 'vitest';
import {
  buildMentorSystemPrompt,
  MENTOR_CONVERSION_MASTER_VERSION,
} from './mentor-conversion-master-prompt';
import { MENTOR_SKILLS } from '../mentor-skills';

describe('mentor-conversion-master-prompt v5 (Fink)', () => {
  it('exposes version 5.x', () => {
    expect(MENTOR_CONVERSION_MASTER_VERSION).toMatch(/^5\.0/);
  });

  it('builds prompt with skills and Fink framework', () => {
    const skills = MENTOR_SKILLS.slice(0, 2);
    const prompt = buildMentorSystemPrompt(skills, false);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('TAXONOMIA DE FINK');
    expect(prompt).toContain('ANTI-ALUCINACAO');
    expect(prompt).toContain('INTELIGENCIA DE TICKET');
    expect(prompt).toContain('SKILL ATIVA');
    expect(prompt).toContain('Trajettu');
  });

  it('uses conversational format when user message is present', () => {
    const skills = [MENTOR_SKILLS[0]];
    const prompt = buildMentorSystemPrompt(skills, true);
    expect(prompt).toContain('CONVERSACIONAL');
    expect(prompt).not.toContain('## Onde voce esta');
  });

  it('uses structured format when no user message', () => {
    const skills = [MENTOR_SKILLS[0]];
    const prompt = buildMentorSystemPrompt(skills, false);
    expect(prompt).toContain('## Onde voce esta');
  });
});
