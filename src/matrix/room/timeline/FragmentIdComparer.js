/*
lookups will be far more frequent than changing fragment order,
so data structure should be optimized for fast lookup

we can have a Map: fragmentId to sortIndex

changing the order, we would need to rebuild the index
lets do this the stupid way for now, changing any fragment rebuilds all islands

to build this:
first load all fragments
put them in a map by id
now iterate through them

until no more fragments
    get the first
    create an island array, and add to list with islands
    going backwards and forwards
        get and remove sibling and prepend/append it to island array
        stop when no more previous/next
    return list with islands

*/

import {isValidFragmentId} from "./common.js";

function findBackwardSiblingFragments(current, byId) {
    const sortedSiblings = [];
    while (isValidFragmentId(current.previousId)) {
        const previous = byId.get(current.previousId);
        if (!previous) {
            break;
        }
        if (previous.nextId !== current.id) {
            throw new Error(`Previous fragment ${previous.id} doesn't point back to ${current.id}`);
        }
        byId.delete(current.previousId);
        sortedSiblings.unshift(previous);
        current = previous;
    }
    return sortedSiblings;
}

function findForwardSiblingFragments(current, byId) {
    const sortedSiblings = [];
    while (isValidFragmentId(current.nextId)) {
        const next = byId.get(current.nextId);
        if (!next) {
            break;
        }
        if (next.previousId !== current.id) {
            throw new Error(`Next fragment ${next.id} doesn't point back to ${current.id}`);
        }
        byId.delete(current.nextId);
        sortedSiblings.push(next);
        current = next;
    }
    return sortedSiblings;
}


function createIslands(fragments) {
    const byId = new Map();
    for(let f of fragments) {
        byId.set(f.id, f);
    }

    const islands = [];
    while(byId.size) {
        const current = byId.values().next().value;
        byId.delete(current.id);
        // new island
        const previousSiblings = findBackwardSiblingFragments(current, byId);
        const nextSiblings = findForwardSiblingFragments(current, byId);
        const island = previousSiblings.concat(current, nextSiblings);
        islands.push(island);
    }
    return islands.map(a => new Island(a));
}

class Island {
    constructor(sortedFragments) {
        this._idToSortIndex = new Map();
        sortedFragments.forEach((f, i) => {
            this._idToSortIndex.set(f.id, i);
        });
    }

    compare(idA, idB) {
        const sortIndexA = this._idToSortIndex.get(idA);
        if (sortIndexA === undefined) {
            throw new Error(`first id ${idA} isn't part of this island`);
        }
        const sortIndexB = this._idToSortIndex.get(idB);
        if (sortIndexB === undefined) {
            throw new Error(`second id ${idB} isn't part of this island`);
        }
        return sortIndexA - sortIndexB;
    }

    get fragmentIds() {
        return this._idToSortIndex.keys();
    }
}

/*
index for fast lookup of how two fragments can be sorted
*/
export default class FragmentIdComparer {
    constructor(fragments) {
        this._fragmentsById = fragments.reduce((map, f) => {map.set(f.id, f); return map;}, new Map());
        this.rebuild(fragments);
    }

    _getIsland(id) {
        const island = this._idToIsland.get(id);
        if (island === undefined) {
            throw new Error(`Unknown fragment id ${id}`);
        }
        return island;
    }

    compare(idA, idB) {
        if (idA === idB) {
            return 0;
        }
        const islandA = this._getIsland(idA);
        const islandB = this._getIsland(idB);
        if (islandA !== islandB) {
            throw new Error(`${idA} and ${idB} are on different islands, can't tell order`);
        }
        return islandA.compare(idA, idB);
    }

    rebuild(fragments) {
        const islands = createIslands(fragments);
        const fragmentJson = JSON.stringify(islands.map(i => {
            return Array.from(i._idToSortIndex.entries())
                .map(([id, idx]) => {return {id, idx};})
                .sort((a, b) => a.idx - b.idx);
        }));
        const firstFragment = this._fragmentsById.values().next().value;
        console.log("rebuilt fragment index", firstFragment && firstFragment.roomId, fragmentJson);
        this._idToIsland = new Map();
        for(let island of islands) {
            for(let id of island.fragmentIds) {
                this._idToIsland.set(id, island);
            }
        }
    }

    add(fragment) {
        this._fragmentsById.set(fragment.id, fragment);
        this.rebuild(this._fragmentsById.values());
    }
}

//#ifdef TESTS
export function tests() {
    return {
        test_1_island_3_fragments(assert) {
            const index = new FragmentIdComparer([
                {id: 3, previousId: 2},
                {id: 1, nextId: 2},
                {id: 2, nextId: 3, previousId: 1},
            ]);
            assert(index.compare(1, 2) < 0);
            assert(index.compare(2, 1) > 0);

            assert(index.compare(1, 3) < 0);
            assert(index.compare(3, 1) > 0);
            
            assert(index.compare(2, 3) < 0);
            assert(index.compare(3, 2) > 0);
            
            assert.equal(index.compare(1, 1), 0);
        },
        test_falsy_id(assert) {
            const index = new FragmentIdComparer([
                {id: 0, nextId: 1},
                {id: 1, previousId: 0},
            ]);
            assert(index.compare(0, 1) < 0);
            assert(index.compare(1, 0) > 0);
        },
        test_falsy_id_reverse(assert) {
            const index = new FragmentIdComparer([
                {id: 1, previousId: 0},
                {id: 0, nextId: 1},
            ]);
            assert(index.compare(0, 1) < 0);
            assert(index.compare(1, 0) > 0);
        },
        test_allow_unknown_id(assert) {
            // as we tend to load fragments incrementally
            // as events come into view, we need to allow
            // unknown previousId/nextId in the fragments that we do load
            assert.doesNotThrow(() => {
                new FragmentIdComparer([
                    {id: 1, previousId: 2},
                    {id: 0, nextId: 3},
                ]);
            });
        },
        test_throw_on_link_mismatch(assert) {
            // as we tend to load fragments incrementally
            // as events come into view, we need to allow
            // unknown previousId/nextId in the fragments that we do load
            assert.throws(() => {
                new FragmentIdComparer([
                    {id: 1, previousId: 0},
                    {id: 0, nextId: 2},
                ]);
            });
        },
        test_2_island_dont_compare(assert) {
            const index = new FragmentIdComparer([
                {id: 1},
                {id: 2},
            ]);
            assert.throws(() => index.compare(1, 2));
            assert.throws(() => index.compare(2, 1));
        },
        test_2_island_compare_internally(assert) {
            const index = new FragmentIdComparer([
                {id: 1, nextId: 2},
                {id: 2, previousId: 1},
                {id: 11, nextId: 12},
                {id: 12, previousId: 11},
                
            ]);

            assert(index.compare(1, 2) < 0);
            assert(index.compare(11, 12) < 0);
            
            assert.throws(() => index.compare(1, 11));
            assert.throws(() => index.compare(12, 2));
        },
        test_unknown_id(assert) {
            const index = new FragmentIdComparer([{id: 1}]);
            assert.throws(() => index.compare(1, 2));
            assert.throws(() => index.compare(2, 1));
        },
        test_rebuild_flushes_old_state(assert) {
            const index = new FragmentIdComparer([
                {id: 1, nextId: 2},
                {id: 2, previousId: 1},
            ]);
            index.rebuild([
                {id: 11, nextId: 12},
                {id: 12, previousId: 11},
            ]);
            
            assert.throws(() => index.compare(1, 2));
            assert(index.compare(11, 12) < 0);
        },
    }
}
//#endif
