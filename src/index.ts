/**
 * So basically, if you go to the official siege stats portal here:
 * https://www.ubisoft.com/en-us/game/rainbow-six/siege/stats/
 * And take a look at the page source code
 * You will see that Ubisoft returns lots of weird un-documented, and nasty data in the window.__PRELOADED_STATE__ variable
 * So, I wrote this script to automatically grab and format those data to the way that I needed in my application.
 * It's a messy script but yeah, saved my time a lot.
 */

import axios from "axios";
import _ from "lodash";
import express from "express";
export const app = express();
const port = 3000;

app.get("/", (req, res) => {
  axios
    .get("https://www.ubisoft.com/en-us/game/rainbow-six/siege/stats/", {
      responseType: "text",
    })
    .then((response) => {
      const regexResults = /<script>window\.__PRELOADED_STATE__ \= (.*?)\;<\/script>/gs.exec(
        response.data
      );
      if (_.isNull(regexResults))
        throw new Error("Could not find any preload data");
      console.log(regexResults[1]);
      const ubisoftData = JSON.parse(regexResults[1]).ContentfulGraphQl;
      if (_.isUndefined(ubisoftData)) throw new Error("Empty GraphQL data");

      /**
       * In this step we successfully extracted GraphQl response
       * In the next step, we need to extract the names of the keys that are dynamic.
       *
       * For example:
       *  G2W Card-5m1VNVEpIXWLf1NeF5ISNm
       *  Operator Loadout-5m1VNVEpIXWLf1NeF5ISNm
       *  Maps Details-5m1VNVEpIXWLf1NeF5ISNm
       *
       * Note: the dynamic key "5m1VNVEpIXWLf1NeF5ISNm" is the same as Y4S4 sys-id (Operation Shifting Tides).
       */

      type Mapper = {
        startsWith: string;
        slug: string;
        contains?: string[];
      };

      const keyMapper: Mapper[] = [
        {
          startsWith: "G2W Card",
          slug: "season",
          contains: [
            "seasons",
            // 'currentSeason',
            "ranks",
          ],
        },
        {
          startsWith: "Operator Loadout",
          slug: "loadout",
          contains: ["operators", "weapons"],
        },
        {
          startsWith: "Maps Details",
          slug: "maps",
        },
      ];

      const data: {
        key: string;
        data: object;
      }[] = [];
      _.mapKeys(ubisoftData, function (value, key) {
        keyMapper.forEach((map): void => {
          if (!key.includes(map.startsWith)) return;
          if (map.contains) {
            map.contains.forEach((mapKey) => {
              data.push({
                key: mapKey,
                data: value.content[mapKey],
              });
            });
          } else {
            data.push({
              key: map.slug,
              data: value.content,
            });
          }
        });
      });

      /**
       * We've successfully extracted raw GraphQL data
       * Now it's time to map them one by one.
       */

      const mapper: { [key: string]: Function } = {
        seasons: mapSeason,
        ranks: mapRanks,
        operators: mapOperators,
        weapons: mapWeapons,
        maps: mapMaps,
      };

      const mappedData: any[] = [];

      data.forEach((dataToMap) => {
        if (typeof mapper[dataToMap.key] === "function")
          mappedData.push({
            name: dataToMap.key,
            data: mapper[dataToMap.key](dataToMap.data),
          });
      });

      res.send({
        seasons: mappedData[0].data,
        ranks: mappedData[1].data,
        operators: mappedData[2].data,
        weapons: mappedData[3].data,
        maps: mappedData[4].data,
      });
    })
    .catch((err) => {
      res.send({ ok: false, error: "Could not fetch Ubisoft page" });
      console.log("There was an error while trying to load the page", err);
    });
});

app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});

const SupportedWeapons = ["primary", "secondary", "gadget", "unique-ability"];

function mapSeason(seasons: any) {
  return seasons.map((season: any) => {
    return {
      slug: season.slug,
      title: season.localizedItems.title.replace("Operation ", ""),
      startDate: season.startDate,
    };
  });
}

function mapRanks(ranks: any) {
  const mappedRanks = ranks.map((rank: any) => {
    /**
     * Sometimes Ubisoft returns two ranks "champion-2" and "champion-3"
     * They don't have any title, I believe this is a simple over-loop bug in their API
     * So Here, I ignore those ranks which doesn't have any title.
     */
    if (!rank.localizedItems) return;

    return {
      slug: rank.slug,
      title: rank.localizedItems.title,
      picture: rank.cardImage.url,
    };
  });

  /**
   * Remove undefined elements from the mapped array before returning
   */
  return _.filter(mappedRanks, (mappedRanks: any) => {
    return mappedRanks !== undefined;
  });
}

function mapOperators(operators: any) {
  return operators.map((operator: any) => {
    return {
      slug: operator.slug,
      name: operator.operatorName,
      icon: operator.operatorIcon.url,

      loadouts: mapLoadout(operator.loadoutCollection.items),

      // array of string
      roles: operator.roles,
      organization: {
        name: operator.localizedItems.factionName,
        icon: operator.localizedItems.factionImage.url,
      },
    };
  });
}

function mapLoadout(loadouts: any) {
  let response: any = {};
  loadouts.map((loadout: any) => {
    if (!_.includes(SupportedWeapons, loadout.weaponType)) {
      throw new Error(
        `Unsupported weapon type [${loadout.weaponType}] for operator loadouts, Make sure to update code.`
      );
    }
    if (_.isUndefined(response[loadout.weaponType]))
      response[loadout.weaponType] = [];
    response[loadout.weaponType].push(loadout.slug);
  });
  return response;
}

function mapWeapons(weapons: any) {
  let response: any = {};
  weapons.map((weapon: any) => {
    if (!_.includes(SupportedWeapons, weapon.weaponType)) {
      throw new Error(
        `Unsupported weapon type [${weapon.weaponType}], Make sure to update code.`
      );
    }
    if (_.isUndefined(response[weapon.weaponType]))
      response[weapon.weaponType] = [];
    response[weapon.weaponType].push({
      slug: weapon.slug,
      title: weapon.localizedItems ? weapon.localizedItems.title : undefined,
      categoryName: weapon.localizedItems
        ? weapon.localizedItems.weaponSubtype
        : undefined,
      image: weapon.weaponImage ? weapon.weaponImage.url : undefined,
    });
  });
  return response;
}

function mapMaps(maps: any) {
  return maps.map((map: any) => {
    return {
      slug: map.slug,
      title: map.mapDetails.title,
      image: map.mapThumbnail.url,
      background: map.mapDetails.backgroundImage.url,
      sites: map.mapDetails.bombSites,
      playlists: map.playlists,
      details: {
        location: map.mapDetails.location,
        released: map.mapDetails.released,
        description: map.mapDetails.content,
      },
    };
  });
}
