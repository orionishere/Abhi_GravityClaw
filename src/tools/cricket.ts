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
        description: 'Get currently live / in-progress cricket matches with scores, teams, venue, and status.',
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
        description: 'List cricket series/tournaments. Optionally search by name (e.g. "IPL", "World Cup").',
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
        description: 'Get detailed info for a specific cricket match by its ID — scorecard, toss, venue, result, etc.',
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
        description: 'Get detailed info for a specific cricket series/tournament by its ID — includes match list.',
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
        description: 'Search for cricket players by name. Returns player IDs you can use with cricket_player_info.',
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
        description: 'Get detailed info for a specific cricket player by ID — biography, role, country, stats.',
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
