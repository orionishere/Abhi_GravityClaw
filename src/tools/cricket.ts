import { config } from '../config.js';

const BASE_URL = 'https://api.cricapi.com/v1';

async function cricketFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('apikey', config.cricketApiKey);
    for (const [k, v] of Object.entries(params)) {
        if (v) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Cricket API error: ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.status === 'failure') throw new Error(`Cricket API failure: ${JSON.stringify(json)}`);
    return json;
}

// ============================
// TOOL SCHEMAS
// ============================

export const cricketCurrentMatchesSchema = {
    type: 'function',
    function: {
        name: 'cricket_current_matches',
        description: 'Get currently live / in-progress cricket matches with scores, teams, venue, and status. Each match includes team names, scores, player of the match, and match ID for use with cricket_match_info.',
        parameters: {
            type: 'object',
            properties: {
                offset: {
                    type: 'number',
                    description: 'Pagination offset (each page = 25 results, default: 0)'
                }
            },
            additionalProperties: false
        }
    }
};

export const cricketSeriesSchema = {
    type: 'function',
    function: {
        name: 'cricket_series',
        description: 'List cricket series/tournaments. Optionally search by name. IMPORTANT: use the full official name for searches (e.g. "Indian Premier League 2026" not "IPL 2026", "ICC Men\'s T20 World Cup" not "T20 WC"). Short abbreviations often return zero results. Returns series IDs you can pass to cricket_series_info to get all matches in that series.',
        parameters: {
            type: 'object',
            properties: {
                search: {
                    type: 'string',
                    description: 'Optional search term to filter series by name'
                },
                offset: {
                    type: 'number',
                    description: 'Pagination offset (each page = 25 results, default: 0)'
                }
            },
            additionalProperties: false
        }
    }
};

export const cricketMatchInfoSchema = {
    type: 'function',
    function: {
        name: 'cricket_match_info',
        description: 'Get detailed info for a specific cricket match by its ID — scorecard with per-player batting/bowling figures, toss, venue, result. Use this to get a player\'s performance in a specific match.',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'The match ID (UUID from match listings)'
                }
            },
            required: ['id'],
            additionalProperties: false
        }
    }
};

export const cricketSeriesInfoSchema = {
    type: 'function',
    function: {
        name: 'cricket_series_info',
        description: 'Get detailed info for a specific cricket series/tournament by its ID — includes the full list of matches with their IDs. Use this to find all matches in a specific season/tournament, then use cricket_match_info on individual matches to get player-level scorecards.',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'The series ID (UUID from series listings)'
                }
            },
            required: ['id'],
            additionalProperties: false
        }
    }
};

export const cricketPlayersSchema = {
    type: 'function',
    function: {
        name: 'cricket_players',
        description: 'Search for cricket players by name. Returns player IDs you can use with cricket_player_info for career stats. Note: player_info only has career aggregates — for season-specific stats, use cricket_series + cricket_series_info + cricket_match_info to look up individual match scorecards.',
        parameters: {
            type: 'object',
            properties: {
                search: {
                    type: 'string',
                    description: 'Player name to search for (e.g. "Virat Kohli")'
                },
                offset: {
                    type: 'number',
                    description: 'Pagination offset (each page = 25 results, default: 0)'
                }
            },
            required: ['search'],
            additionalProperties: false
        }
    }
};

export const cricketPlayerInfoSchema = {
    type: 'function',
    function: {
        name: 'cricket_player_info',
        description: 'Get detailed info for a specific cricket player by ID — biography, role, country, and CAREER-AGGREGATE stats by format (Test/ODI/T20/IPL). Does NOT have per-season breakdowns. For season-specific stats, instead use: cricket_series (search tournament) → cricket_series_info (get match list) → cricket_match_info (get per-match scorecards).',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'The player ID (UUID from player search results)'
                }
            },
            required: ['id'],
            additionalProperties: false
        }
    }
};

// ============================
// EXECUTORS
// ============================

export async function cricketCurrentMatches(args: any): Promise<string> {
    const data = await cricketFetch('currentMatches', {
        offset: args.offset?.toString() || '0'
    });
    return JSON.stringify(data, null, 2);
}

export async function cricketSeries(args: any): Promise<string> {
    const params: Record<string, string> = { offset: args.offset?.toString() || '0' };
    if (args.search) params.search = args.search;
    const data = await cricketFetch('series', params);
    return JSON.stringify(data, null, 2);
}

export async function cricketMatchInfo(args: { id: string }): Promise<string> {
    const data = await cricketFetch('match_info', { id: args.id });
    return JSON.stringify(data, null, 2);
}

export async function cricketSeriesInfo(args: { id: string }): Promise<string> {
    const data = await cricketFetch('series_info', { id: args.id });
    return JSON.stringify(data, null, 2);
}

export async function cricketPlayers(args: any): Promise<string> {
    const data = await cricketFetch('players', {
        search: args.search,
        offset: args.offset?.toString() || '0'
    });
    return JSON.stringify(data, null, 2);
}

export async function cricketPlayerInfo(args: { id: string }): Promise<string> {
    const data = await cricketFetch('players_info', { id: args.id });
    return JSON.stringify(data, null, 2);
}
