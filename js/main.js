(function(){
    'use strict';
    const ROUTER = 'https://route.paket.global/v3/';
    const TILE_PROVIDER = 'https://{s}.tile.osm.org/{z}/{x}/{y}.png';
    const TILE_ATTRIBUTION = '&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors';
    const TILE_SETTINGS = {
        maxZoom: 19,
        minZoom: 2,
        attribution: TILE_ATTRIBUTION,
    };
    const MAP_DEFAULT_LOCATION = [32.06, 34.77];
    const MAP_DEFAULT_ZOOM = 8;
    const HEATMAP_SETTINGS = {
        radius: 50,
        maxZoom: 16,
        max: 1,
        minOpacity: 0.3,
        blur: 40,
        gradient: {0.2: 'gold', 0.4: 'orange', 1: 'OrangeRed'},
    };
    const RED_ICON = {
        iconUrl: 'red_location.png',
        iconSize: [38, 38],
        iconAnchor: [22, 37],
        popupAnchor: [-3, -38],
    };
    const ORANGE_ICON = {
        iconUrl: 'orange_location.png',
        iconSize: [38, 38],
        iconAnchor: [22, 37],
        popupAnchor: [-3, -38],
    };
    const GREEN_ICON = {
        iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
    };

    function twodigitize(number){
        if(number < 10){
            number = '0' + number;
        }
        return number;
    }

    function formatDatetime(datetime){
        return (
            datetime.getFullYear() + '/' +
            twodigitize(datetime.getMonth() + 1) + '/' +
            twodigitize(datetime.getDate()) + ' ' +
            twodigitize(datetime.getHours()) + ':' +
            twodigitize(datetime.getMinutes()) + ':' +
            twodigitize(datetime.getSeconds())
        );
    }

    function formatTimestamp(timestamp){
        return formatDatetime(new Date(timestamp));
    }

    function formatRFC1123(rfc){
        return formatDatetime(new Date(Date.parse(rfc)));
    }

    function initMap(){
        let tiles = L.tileLayer(TILE_PROVIDER, TILE_SETTINGS);
        let map = L.map('heatmap').setView(MAP_DEFAULT_LOCATION, MAP_DEFAULT_ZOOM).addLayer(tiles);
        let heat = L.heatLayer([], HEATMAP_SETTINGS).addTo(map);
        L.control.scale({imperial: false}).addTo(map);
        return {map: map, heat: heat};
    }

    function initPackageMapLayer(pckg){
        let locations = [];
        let markers = [];

        $.each(pckg.events, function(eventIndex, event){
            let location = event.location.split(',');
            let marker = L.marker([location[0], location[1]], {
                icon: new L.icon((event.event_type === 'launched') ? RED_ICON : GREEN_ICON)
            }).bindPopup('<b>Event type: ' + event.event_type + '</b><br>Time: ' + formatTimestamp(event.timestamp));
            locations.push(location);
            markers.push(marker);
        });
        let location = pckg.to_location.split(',');
        let marker = L.marker(location, {icon: new L.icon(ORANGE_ICON)}).bindPopup('<b>final destination</b>');
        locations.push(location);
        markers.push(marker);

        return L.layerGroup([new L.Polyline(locations)].concat(markers));
    }

    function callRouter(endpoint, data, callback, fail){
        let formData = new FormData();
        $.each(data, function(key, value){
            formData.append(key, value);
        });
        $.ajax({
            type: 'POST',
            url: ROUTER + endpoint,
            dataType: 'json',
            data: formData,
            processData: false,
            contentType: false,
            success: function(result){
                if(callback){
                    callback(result);
                }
            },
            error: function(result){
                console.error(endpoint, data, result);
                if(fail){
                    fail(result);
                }
            }
        });
    }

    function getEvents(callback){
        callRouter('events', {max_events_num: 10000}, function(result){
            callback(result.events, result.package_event_types);
        });
    }

    function getPackage(escrow_pubkey, callback){
        callRouter('package', {escrow_pubkey: escrow_pubkey}, function(result){
            callback(result.package);
        });
    }

    function fillPackageStats(package_event_types){
        let enroute = 0;
        let received = 0;
        $.each(package_event_types, function(package_id, event_types){
            if(event_types.indexOf('received') > -1){
                received++;
                return true;
            }
            if(event_types.indexOf('expired') > -1){
                return true;
            }
            enroute++;
        });
        $('#enroutePackages').text(enroute);
        $('#receivedPackages').text(received);
        $('#totalPackages').text(Object.keys(package_event_types).length);
    }

    function fillUserStats(events){
        let activeUsers = [];
        let now = new Date();
        $.each(events, function(eventIndex, event){
            if(
                !(event.user_pubkey in activeUsers) &&
                now - new Date(Date.parse(event.timestamp)) < 24 * 60 * 60 * 1000
            ){
                activeUsers.push(event.user_pubkey);
            }
        });
        $('#activeUsers').text(activeUsers.length);
    }

    function fillEventsTable(events){
        let eventTable = $('#packageDetails tbody');
        eventTable.find('tr').remove();
        $.each(events, function(eventIndex, event){
            eventTable.append('<tr>' +
                '<th scope="row">' + eventIndex + '</th>' +
                '<td>' + event.event_type + '</td>' +
                '<td style="font-family: monospace; font-size: 75%">' + event.location + '</td>' +
                '<td>' + formatRFC1123(event.timestamp) + '</td>' +
                '<td title="' + event.user_pubkey + '">' + event.user_pubkey.substring(0, 3) + '...' + event.user_pubkey.substring(event.user_pubkey.length - 4, event.user_pubkey.length - 1) + '</td>' +
                '<td>' + JSON.stringify(JSON.parse(event.kwargs), undefined, 2) + '</td>' +
            '</tr>');
        });
    }

    function removePackageLayers(map){
        map.eachLayer(function(layer){
            if(!('_url' in layer) && (!('_heat' in layer))){
                map.removeLayer(layer);
            }
        });
    }

    function resetMap(map){
        $('#packageDetails').hide();
        removePackageLayers(map);
        map.setView(MAP_DEFAULT_LOCATION, MAP_DEFAULT_ZOOM);
    }

    function viewLayer(map, layer){
        removePackageLayers(map);
        map.addLayer(layer);
        map.fitBounds(layer.getLayers()[0].getBounds());
    }

    function showPackageDetails(pckg, map){
        $('#closeDetails').click(function(){resetMap(map);});
        $('#fullEscrowPubkey').text(pckg.escrow_pubkey);
        $('#fromAddress').text(pckg.from_address);
        $('#toAddress').text(pckg.to_address);
        $('#payment').text(pckg.payment + ' BUL (€' + pckg.payment * 0.12 + ')');
        $('#collateral').text(pckg.collateral + ' BUL (€' + pckg.collateral * 0.12 + ')');
        $('#deadline').text(formatTimestamp(pckg.deadline * 1000));
        $('#escrowUrl').attr('href', pckg.blockchain_url); // This is silly
        $('#explorerUrl').attr('href', pckg.blockchain_url);
        if(pckg.photo){
            $('#packageDetails #img').attr('src', pckg.photo);
        }
        else{
            $('#packageDetails #img').attr('src', 'empty-photo.jpg');
        }
        fillEventsTable(pckg.events);
        $('#packageDetails').show();
        viewLayer(map, pckg.mapLayer);
    }

    function addPackageRow(pckg, packageTable, map){
        if(pckg.launcher_pubkey !== 'GAIKK74K2DLWKK6FCDMAHPCF2GSERKBXV5GZJCQ4MQINZOYMXOPQYU4O') return;

        $(packageTable.row.add([
            pckg.short_package_id, pckg.status, pckg.description, pckg.to_address,
            formatRFC1123(pckg.launch_date), formatRFC1123(pckg.events[pckg.events.length - 1].timestamp),
        ]).nodes()[0]).addClass('package-' + pckg.status.replace(' ', '-')).click(function(){
            showPackageDetails(pckg, map);
        });

        pckg.mapLayer = initPackageMapLayer(pckg);

        if(!('photo' in pckg && pckg.photo)){
            callRouter('package_photo', {escrow_pubkey: pckg.escrow_pubkey}, function(result){
                if(result.package_photo !== null){
                    pckg.photo = 'data:image/png;base64,' + result.package_photo.photo;
                }
            });
        }
    }

    function refreshPackageRows(package_event_types, packageTable, map, done){
        let doneRows = 0;
        packageTable.clear();
        $.each(package_event_types, function(escrow_pubkey, event_types){
            getPackage(escrow_pubkey, function(pckg){
                addPackageRow(pckg, packageTable, map);
                doneRows++;
                if(doneRows === Object.keys(package_event_types).length){
                    done();
                }
            });
        });
    }

    function refreshHeatmap(events, heat){
        heat.setLatLngs([]);
        $.each(events, function(eventIndex, event){
            heat.addLatLng(event.location.split(',').concat(event.event_type === 'location changed' ? 0.5 : 1));
        });
    }

    function refreshData(packageTable, heatmap){
        getEvents(function(events, package_event_types){
            $('#totalEvents').text(events.length);
            fillPackageStats(package_event_types);
            fillUserStats(events);
            refreshHeatmap(events, heatmap.heat);
            refreshPackageRows(package_event_types, packageTable, heatmap.map, function(){
                packageTable.draw(true);
                setTimeout(function(){refreshData(packageTable, heatmap);}, 60 * 1000);
            });
        });
    }

    $(document).ready(function(){
        refreshData($('#tablePackages').DataTable({paging: false}), initMap());
    });
}());
