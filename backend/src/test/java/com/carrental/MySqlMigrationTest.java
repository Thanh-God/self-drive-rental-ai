package com.carrental;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in, real MySQL only. Creates new named schemas; never drops/cleans/repairs. */
@EnabledIfEnvironmentVariable(named="KDRIVE_MIGRATION_MYSQL_URL", matches="jdbc:mysql:.*")
class MySqlMigrationTest {
 private final String base=System.getenv("KDRIVE_MIGRATION_MYSQL_URL");
 private final String user=System.getenv("KDRIVE_MIGRATION_MYSQL_USER");
 private final String password=System.getenv("KDRIVE_MIGRATION_MYSQL_PASSWORD");
 private JdbcTemplate jdbc(String schema){return new JdbcTemplate(new DriverManagerDataSource(base.replace("/mysql?","/"+schema+"?"),user,password));}
 private Flyway flyway(String schema,String target){var config=Flyway.configure().dataSource(jdbc(schema).getDataSource()).locations("classpath:db/migration").cleanDisabled(true).baselineOnMigrate(false);if(target!=null)config.target(target);return config.load();}
 private List<Map<String,Object>> data(JdbcTemplate j){var result=new ArrayList<Map<String,Object>>();for(String table:j.queryForList("select table_name from information_schema.tables where table_schema=database() and table_name <> 'flyway_schema_history' order by table_name",String.class)){for(var row:j.queryForList("select * from `"+table+"` order by 1")){var copy=new TreeMap<String,Object>(row);copy.put("_table",table);result.add(copy);}}return result;}
 private List<Map<String,Object>> structure(JdbcTemplate j){var result=new ArrayList<Map<String,Object>>();for(String sql:List.of(
  "select table_name,column_name,column_type,is_nullable,column_default,extra from information_schema.columns where table_schema=database() and table_name <> 'flyway_schema_history' order by table_name,ordinal_position",
  "select table_name,index_name,non_unique,seq_in_index,column_name from information_schema.statistics where table_schema=database() and table_name <> 'flyway_schema_history' order by table_name,index_name,seq_in_index",
  "select table_name,constraint_name,column_name,referenced_table_name,referenced_column_name from information_schema.key_column_usage where table_schema=database() and table_name <> 'flyway_schema_history' order by table_name,constraint_name,ordinal_position",
  "select constraint_name,check_clause from information_schema.check_constraints where constraint_schema=database() order by constraint_name"))result.addAll(j.queryForList(sql));return result;}
 @Test void partialHistoricalV2BlocksRetryWithoutRepair()throws Exception{
  String archive=System.getenv("KDRIVE_HISTORICAL_MIGRATION_DIR");
  org.junit.jupiter.api.Assumptions.assumeTrue(archive!=null,"Historical migration snapshot is required for this probe");
  assertTrue(base.matches("jdbc:mysql://(127\\.0\\.0\\.1|localhost):[0-9]+/mysql\\?.*"));
  String schema="phase5_p_"+UUID.randomUUID().toString().replace("-","");jdbc("mysql").execute("create database `"+schema+"` character set utf8mb4 collate utf8mb4_0900_ai_ci");
  var old=Flyway.configure().dataSource(jdbc(schema).getDataSource()).locations("filesystem:"+Path.of(archive).toAbsolutePath().toString().replace('\\','/')).cleanDisabled(true).target("1").load();old.migrate();
  var j=jdbc(schema);try(var connection=j.getDataSource().getConnection()){ScriptUtils.executeSqlScript(connection,new ClassPathResource("db/fixture/phase5-v1-data.sql"));}
  var oldV2=Flyway.configure().dataSource(j.getDataSource()).locations("filesystem:"+Path.of(archive).toAbsolutePath().toString().replace('\\','/')).cleanDisabled(true).load();
  assertThrows(org.flywaydb.core.api.FlywayException.class,oldV2::migrate);
  assertEquals(1,j.queryForObject("select count(*) from flyway_schema_history where version='2' and success=0",Integer.class));
  assertEquals(6,j.queryForObject("select count(*) from information_schema.columns where table_schema=database() and table_name='incident_events' and column_name in ('previous_status','next_status','assessed_damage','third_party_coverage','requested_amount','responsibility_basis')",Integer.class));
  assertEquals("bigint",j.queryForObject("select data_type from information_schema.columns where table_schema=database() and table_name='reviews' and column_name='vehicle_id'",String.class));
  var before=data(j);assertThrows(org.flywaydb.core.api.FlywayException.class,()->flyway(schema,null).migrate());assertEquals(before,data(j));
  assertEquals("Preserve this review",j.queryForObject("select content from reviews where id='review-audit'",String.class));
  String output=System.getenv("KDRIVE_MIGRATION_ARTIFACT_DIR");if(output!=null)Files.writeString(Path.of(output).resolve("partial-history.txt"),"schema="+schema+"\n"+j.queryForList("select * from flyway_schema_history order by installed_rank")+"\n"+structure(j));
 }
 @Test void freshAndV1UpgradePreserveDataAndMatchSchema()throws Exception{
  assertTrue(base.matches("jdbc:mysql://(127\\.0\\.0\\.1|localhost):[0-9]+/mysql\\?.*"),"Explicit isolated local MySQL admin URL required");
  String suffix=UUID.randomUUID().toString().replace("-","");String fresh="phase5_f_"+suffix,upgrade="phase5_u_"+suffix;
  var admin=jdbc("mysql");assertTrue(admin.queryForObject("select version()",String.class).startsWith("8.4."));
  for(String schema:List.of(fresh,upgrade))admin.execute("create database `"+schema+"` character set utf8mb4 collate utf8mb4_0900_ai_ci");
  var f=flyway(fresh,null);assertEquals(2,f.migrate().migrationsExecuted);f.validate();
  var v1=flyway(upgrade,"1");assertEquals(1,v1.migrate().migrationsExecuted);
  var u=jdbc(upgrade);try(var connection=u.getDataSource().getConnection()){ScriptUtils.executeSqlScript(connection,new ClassPathResource("db/fixture/phase5-v1-data.sql"));}
  var before=data(u);assertFalse(before.isEmpty());
  var v2=flyway(upgrade,null);assertEquals(1,v2.migrate().migrationsExecuted);v2.validate();
  // All original columns/rows must remain exactly equal; only new nullable event fields differ.
  var after=data(u);for(var row:after)if("incident_events".equals(row.get("_table")))for(String c:List.of("previous_status","next_status","assessed_damage","third_party_coverage","requested_amount","responsibility_basis")){assertNull(row.remove(c));}
  assertEquals(before,after);
  assertEquals(structure(jdbc(fresh)),structure(u));
  assertEquals(26,u.queryForObject("select count(*) from information_schema.tables where table_schema=database()",Integer.class));
  assertEquals(37,u.queryForObject("select count(*) from information_schema.referential_constraints where constraint_schema=database()",Integer.class));
  assertEquals(0,u.queryForObject("select count(*) from information_schema.columns where table_schema=database() and table_name='reviews' and column_name='vehicle_id'",Integer.class));
  assertEquals("bigint",u.queryForObject("select data_type from information_schema.columns where table_schema=database() and table_name='incident_events' and column_name='requested_amount'",String.class));
  assertEquals(0,v2.migrate().migrationsExecuted);
  for(String schema:List.of(fresh,upgrade))assertEquals(2,jdbc(schema).queryForObject("select count(*) from flyway_schema_history where success=1",Integer.class));
  String output=System.getenv("KDRIVE_MIGRATION_ARTIFACT_DIR");if(output!=null){Path dir=Path.of(output);Files.createDirectories(dir);Files.writeString(dir.resolve("migration-schema.txt"),"fresh="+fresh+"\nupgrade="+upgrade+"\n"+structure(u));Files.writeString(dir.resolve("upgrade-preservation.txt"),"before="+before+"\nafter="+after+"\nequal="+before.equals(after));Files.writeString(dir.resolve("flyway-history.txt"),u.queryForList("select * from flyway_schema_history order by installed_rank").toString());}
 }
}
