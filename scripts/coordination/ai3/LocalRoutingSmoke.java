import com.carrental.modules.ai.routing.OsrmRoutingClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

/** Run with Java21 and the compiled backend/Jackson classpath, while local OSRM is running. */
class LocalRoutingSmoke {
    public static void main(String[] args) throws Exception {
        var json=new ObjectMapper();
        var client=new OsrmRoutingClient(json);
        var destination=new OsrmRoutingClient.Point(15.8801,108.338);
        var route=client.route(List.of(new OsrmRoutingClient.Point(16.0544,108.2022),destination));
        if(route.status()!=OsrmRoutingClient.Status.VERIFIED || route.distanceMeters()==null
            || route.durationSeconds()==null || route.distanceMeters()<10000 || route.distanceMeters()>100000)
            throw new AssertionError("Production adapter did not verify the local driving route");
        var missing=client.route(List.of(new OsrmRoutingClient.Point(0,0),destination));
        if(missing.status()!=OsrmRoutingClient.Status.NO_ROUTE || missing.distanceMeters()!=null || missing.durationSeconds()!=null)
            throw new AssertionError("Off-network coordinates must not produce an estimate");
        System.out.println(json.writeValueAsString(java.util.Map.of("route",route,"missing",missing)));
    }
}
