/**
 * Squad Size Configuration
 * Controls player count per team across the entire tournament system
 * 
 * Supported values: 2 (duo), 4 (squad)
 * Default: 4
 */

const SQUAD_SIZE = process.env.TEAM_SQUAD_SIZE ? parseInt(process.env.TEAM_SQUAD_SIZE, 10) : 4;

if (![2, 4].includes(SQUAD_SIZE)) {
  throw new Error(`Invalid TEAM_SQUAD_SIZE: ${SQUAD_SIZE}. Must be 2 or 4.`);
}

export const SQUAD_CONFIG = {
  /** Maximum players per team */
  maxPlayers: SQUAD_SIZE,
  /** Maximum player index (0-based) */
  maxPlayerIndex: SQUAD_SIZE - 1,
  /** Valid elimination states: full elimination at this count */
  fullEliminationCount: SQUAD_SIZE,
  /** Player display format (e.g., "P1", "P2") */
  getPlayerLabel: (index) => `P${index + 1}`,
  /** Validation helper for player indices */
  isValidPlayerIndex: (index) => typeof index === 'number' && index >= 0 && index < SQUAD_SIZE,
};

export default SQUAD_CONFIG;
